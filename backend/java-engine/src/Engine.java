import com.github.javaparser.*;
import com.github.javaparser.ast.*;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.stmt.*;
import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.stream.Collectors;

/** Trusted, bounded JSON CLI. Submitted Java is parsed as data, never executed. */
public final class Engine {
    static final Gson JSON = new GsonBuilder().disableHtmlEscaping().create();
    static final DataKey<String> ID = new DataKey<>() {};
    static final ParserConfiguration CONFIG = new ParserConfiguration()
        .setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21);
    record Unit(String path, String content, CompilationUnit ast) {}
    final List<Unit> units = new ArrayList<>();
    final List<Map<String,Object>> errors = new ArrayList<>();
    final List<Map<String,Object>> nodes = new ArrayList<>();
    final List<Map<String,Object>> edges = new ArrayList<>();
    final Set<String> warnings = new LinkedHashSet<>();
    final List<Map<String,Object>> changes = new ArrayList<>();
    final Set<CompilationUnit> changedUnits = Collections.newSetFromMap(new IdentityHashMap<>());
    record JumpTargets(String breakTo, String continueTo) {}
    final Map<String, JumpTargets> labels = new HashMap<>();
    final Map<String, Node> byId = new LinkedHashMap<>();
    final Map<String, String> paths = new HashMap<>();

    static Map<String,Object> obj(Object... pairs) {
        Map<String,Object> map = new LinkedHashMap<>();
        for (int i=0; i<pairs.length; i+=2) map.put((String)pairs[i], pairs[i+1]);
        return map;
    }
    static String str(JsonObject o, String key) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : "";
    }
    static String stable(String text) {
        return UUID.nameUUIDFromBytes(text.getBytes(StandardCharsets.UTF_8)).toString();
    }
    static List<Node> children(Node n) {
        // getChildNodes() follows mutation insertion order. Metamodel property order
        // remains stable when a setter replaces a child, and after reparsing.
        List<Node> children = new ArrayList<>();
        for (var property : n.getMetaModel().getAllPropertyMetaModels()) {
            if (!property.isNode()) continue;
            Object value = property.getValue(n);
            if (value instanceof Optional<?> optional) value = optional.orElse(null);
            if (value instanceof Node child) children.add(child);
            else if (value instanceof Iterable<?> list) for (Object item : list) if (item instanceof Node child) children.add(child);
        }
        return children;
    }
    static List<Node> preorder(Node n) {
        List<Node> result = new ArrayList<>();
        result.add(n);
        for (Node child : children(n)) result.addAll(preorder(child));
        return result;
    }
    void assign(Node n, String file, String path, Map<String,String> known) {
        if (!n.containsData(ID)) n.setData(ID, known.getOrDefault(file+":"+path, stable(file+":"+path)));
        paths.put(n.getData(ID), path);
        byId.put(n.getData(ID), n);
        List<Node> children = children(n);
        for (int i=0; i<children.size(); i++) assign(children.get(i), file, path+"."+i, known);
    }
    CompilationUnit parse(String file, String code) {
        ParseResult<CompilationUnit> parsed = new JavaParser(CONFIG).parse(code);
        if (!parsed.isSuccessful()) {
            parsed.getProblems().forEach(p -> {
                Map<String,Object> e = obj("file", file, "message", p.getMessage());
                p.getLocation().flatMap(TokenRange::toRange).ifPresent(r -> {
                    e.put("line", r.begin.line); e.put("column", r.begin.column);
                });
                errors.add(e);
            });
            return null;
        }
        return parsed.getResult().orElseThrow();
    }
    static boolean shown(Node n) {
        if (n.findAncestor(LambdaExpr.class).isPresent() || n.findAncestor(SwitchExpr.class).isPresent()) return false;
        return n instanceof CallableDeclaration || n instanceof CompactConstructorDeclaration || n instanceof FieldDeclaration ||
            n instanceof Statement && !(n instanceof BlockStmt);
    }
    static String kind(Node n) {
        if (n instanceof CallableDeclaration || n instanceof CompactConstructorDeclaration) return "method";
        if (n instanceof FieldDeclaration || n instanceof ExpressionStmt e && e.getExpression() instanceof VariableDeclarationExpr) return "variable";
        if (n instanceof IfStmt || n instanceof SwitchStmt) return "condition";
        if (loop(n)) return "loop";
        if (n instanceof ReturnStmt) return "return";
        return "operation";
    }
    static boolean loop(Node n) {
        return n instanceof ForStmt || n instanceof ForEachStmt || n instanceof WhileStmt || n instanceof DoStmt;
    }
    static String snippet(Node n) {
        if (n instanceof IfStmt s) return s.getCondition().toString();
        if (n instanceof SwitchStmt s) return s.getSelector().toString();
        if (n instanceof WhileStmt s) return s.getCondition().toString();
        if (n instanceof DoStmt s) return s.getCondition().toString();
        if (n instanceof ForStmt s) return s.getCompare().map(Object::toString).orElse("true");
        if (n instanceof ForEachStmt s) return s.getIterable().toString();
        if (n instanceof FieldDeclaration f && f.getVariables().size() == 1) return f.getVariable(0).getInitializer().map(Object::toString).orElse("");
        if (n instanceof CallableDeclaration<?> c) return c.getDeclarationAsString();
        if (n instanceof CompactConstructorDeclaration c) return c.getNameAsString() + " { … }";
        return n.toString();
    }
    static List<String> editable(Node n) {
        List<String> ops = new ArrayList<>();
        if (n instanceof IfStmt || n instanceof WhileStmt || n instanceof DoStmt || n instanceof ForStmt) ops.add("updateCondition");
        if (n instanceof SwitchStmt || n instanceof ExpressionStmt || n instanceof ReturnStmt || n instanceof ThrowStmt || n instanceof ForEachStmt) ops.add("updateExpression");
        if (n instanceof FieldDeclaration || n instanceof ExpressionStmt e && e.getExpression() instanceof VariableDeclarationExpr) ops.add("updateVariable");
        if (n instanceof Statement && statements(n) != null) {
            ops.addAll(List.of("replaceStatement", "deleteBlock", "duplicateBlock", "addBlock"));
        }
        if (n instanceof Statement && !(n instanceof BlockStmt) && !ops.contains("replaceStatement")) ops.add("replaceStatement");
        if (n instanceof MethodDeclaration m && m.getBody().isPresent() || n instanceof ConstructorDeclaration || n instanceof CompactConstructorDeclaration) ops.add("addBlock");
        if (Methods.accepts(n)) ops.add("addMethod");
        if (n instanceof MethodDeclaration && n.getParentNode().orElse(null) instanceof TypeDeclaration<?> owner && Methods.accepts(owner)) ops.addAll(List.of("replaceMethod", "deleteMethod", "duplicateMethod"));
        return ops;
    }
    static NodeList<Statement> statements(Node n) {
        Node parent = n.getParentNode().orElse(null);
        return parent instanceof BlockStmt b ? b.getStatements() : parent instanceof SwitchEntry entry ? entry.getStatements() : null;
    }
    static String displayCode(Node n) {
        if (n instanceof ForStmt f) return "for ("+f.getInitialization().stream().map(Object::toString).collect(java.util.stream.Collectors.joining(", "))+"; "+f.getCompare().map(Object::toString).orElse("")+"; "+f.getUpdate().stream().map(Object::toString).collect(java.util.stream.Collectors.joining(", "))+")";
        if (n instanceof ForEachStmt f) return "for ("+f.getVariable()+" : "+f.getIterable()+")";
        if (n instanceof WhileStmt w) return "while ("+w.getCondition()+")";
        if (n instanceof DoStmt d) return "do … while ("+d.getCondition()+")";
        if (n instanceof TryStmt t) return t.getResources().isEmpty() ? "try / catch / finally" : "try ("+t.getResources()+")";
        if (n instanceof LabeledStmt l) return l.getLabel()+":";
        if (n instanceof FieldDeclaration) return n.toString();
        return snippet(n);
    }
    static String graphWarning(Node n) {
        if (n instanceof CompactConstructorDeclaration) return "Компактный конструктор record: показано явное тело; неявные присваивания компонент не развёрнуты.";
        if (n instanceof TryStmt) return "Структурная схема: переходы исключений и выходы через finally показаны неполно.";
        if (!(n instanceof CallableDeclaration) && (n.findFirst(LambdaExpr.class).isPresent() || n.findFirst(SwitchExpr.class).isPresent())) return "Тело лямбды / switch-выражения сохранено в Java; внутренний поток не развёрнут на схеме.";
        return "";
    }
    void describe(Node n, Unit u, String parent, String method, int depth, int loopDepth) {
        boolean display = shown(n);
        String nextMethod = n instanceof CallableDeclaration || n instanceof CompactConstructorDeclaration ? n.getData(ID) : method;
        if (display) {
            Range range = n.getRange().orElse(new Range(new Position(1,1),new Position(1,1)));
            Map<String,Object> row = obj("id", n.getData(ID), "astPath", paths.get(n.getData(ID)),
                "astKind", n.getClass().getSimpleName(), "kind", kind(n),
                "title", n instanceof CallableDeclaration<?> c ? c.getNameAsString() : n instanceof CompactConstructorDeclaration c ? c.getNameAsString() : n instanceof FieldDeclaration f ? f.getVariables().stream().map(VariableDeclarator::getNameAsString).collect(java.util.stream.Collectors.joining(", ")) : n instanceof ExpressionStmt e && e.getExpression() instanceof VariableDeclarationExpr v ? v.getVariables().stream().map(VariableDeclarator::getNameAsString).collect(java.util.stream.Collectors.joining(", ")) : n.getClass().getSimpleName().replace("Stmt", ""),
                "code", n.toString(), "snippet", snippet(n), "displayCode", displayCode(n), "warning", graphWarning(n), "depth", depth, "loopDepth", loopDepth,
                "editable", editable(n), "source", obj("file", u.path, "startLine", range.begin.line,
                    "endLine", range.end.line, "startColumn", range.begin.column, "endColumn", range.end.column));
            if (parent != null) row.put("parentId", parent);
            if (nextMethod != null) row.put("methodId", nextMethod);
            n.findAncestor(TypeDeclaration.class).ifPresent(owner -> row.put("containerId", owner.getData(ID)));
            if (n instanceof MethodDeclaration declaration) row.put("method", Methods.metadata(declaration));
            if (n instanceof CallableDeclaration<?> callable) row.put("complexity", Complexity.inspect(callable));
            nodes.add(row);
        }
        for (Node c : n.getChildNodes()) describe(c, u, display ? n.getData(ID) : parent,
            nextMethod, depth+(display ? 1 : 0), loopDepth+(loop(n) ? 1 : 0));
    }
    void edge(String source, String target, String kind, String label) {
        if (source == null || target == null) return;
        Map<String,Object> edge = obj("source", source, "target", target, "kind", kind);
        if (label != null) edge.put("label", label);
        if (!edges.contains(edge)) edges.add(edge);
    }
    String sequence(List<? extends Statement> statements, String next, String breakTo, String continueTo) {
        String entry = next;
        for (int i=statements.size()-1; i>=0; i--) entry = flow(statements.get(i), entry, breakTo, continueTo);
        return entry;
    }
    String flow(Statement s, String next, String breakTo, String continueTo) {
        if (s instanceof BlockStmt b) return sequence(b.getStatements(), next, breakTo, continueTo);
        String id = s.getData(ID);
        if (s instanceof IfStmt v) {
            edge(id, flow(v.getThenStmt(), next, breakTo, continueTo), "branch", "true");
            edge(id, v.getElseStmt().map(x -> flow(x, next, breakTo, continueTo)).orElse(next), "branch", "false");
        } else if (loop(s)) {
            Statement body = s instanceof ForStmt f ? f.getBody() : s instanceof ForEachStmt f ? f.getBody() : s instanceof WhileStmt w ? w.getBody() : ((DoStmt)s).getBody();
            String bodyId = flow(body, id, next, id);
            edge(id, bodyId, "loop", "repeat");
            if (!(s instanceof ForStmt f && f.getCompare().isEmpty())) edge(id, next, "branch", "exit");
            return s instanceof DoStmt ? bodyId : id;
        } else if (s instanceof SwitchStmt v) {
            String fallthrough = next;
            boolean hasDefault = false;
            List<SwitchEntry> entries = v.getEntries();
            for (int i=entries.size()-1; i>=0; i--) {
                SwitchEntry entry = entries.get(i);
                String target = sequence(entry.getStatements(), entry.getType() == SwitchEntry.Type.STATEMENT_GROUP ? fallthrough : next, next, continueTo);
                edge(id, target, "branch", entry.getLabels().isEmpty() ? "default" : entry.getLabels().toString());
                fallthrough = target;
                hasDefault |= entry.getLabels().isEmpty();
            }
            if (!hasDefault) edge(id, next, "branch", "no match");
        } else if (s instanceof TryStmt v) {
            warnings.add("Exception edges are structural approximations; abrupt exits through finally and resource cleanup are not a full Java CFG.");
            String after = v.getFinallyBlock().map(b -> flow(b, next, breakTo, continueTo)).orElse(next);
            edge(id, flow(v.getTryBlock(), after, breakTo, continueTo), "flow", "try");
            v.getCatchClauses().forEach(c -> edge(id, flow(c.getBody(), after, breakTo, continueTo), "exception", c.getParameter().getType().toString()));
        } else if (s instanceof BreakStmt b) {
            if (b.getLabel().isPresent()) {
                JumpTargets target = labels.get(b.getLabel().get().asString());
                if (target != null) edge(id,target.breakTo(),"jump","break "+b.getLabel().get());
                else warnings.add("Unresolved labeled break: "+b.getLabel().get());
            }
            else edge(id, breakTo, "jump", "break");
        } else if (s instanceof ContinueStmt c) {
            if (c.getLabel().isPresent()) {
                JumpTargets target = labels.get(c.getLabel().get().asString());
                if (target != null && target.continueTo()!=null) edge(id,target.continueTo(),"jump","continue "+c.getLabel().get());
                else warnings.add("Unresolved labeled continue: "+c.getLabel().get());
            }
            else edge(id, continueTo, "jump", "continue");
        } else if (s instanceof LabeledStmt l) {
            String label = l.getLabel().asString();
            JumpTargets previous = labels.put(label,new JumpTargets(next,loop(l.getStatement())?l.getStatement().getData(ID):null));
            try { edge(id, flow(l.getStatement(), next, breakTo, continueTo), "flow", "label"); }
            finally { if(previous==null) labels.remove(label); else labels.put(label,previous); }
        } else if (s instanceof SynchronizedStmt sync) {
            edge(id, flow(sync.getBody(), next, breakTo, continueTo), "flow", "synchronized");
        } else if (!(s instanceof ReturnStmt || s instanceof ThrowStmt || s instanceof YieldStmt)) {
            edge(id, next, "flow", null);
        }
        return id;
    }
    void transform(JsonObject op) {
        String type = str(op, "type");
        Node n = byId.get(str(op, "nodeId"));
        if (n == null) throw new IllegalArgumentException("Unknown nodeId");
        if (!editable(n).contains(type)) throw new IllegalArgumentException(type+" is not supported for "+n.getClass().getSimpleName());
        changedUnits.add(n.findCompilationUnit().orElseThrow());
        JavaParser parser = new JavaParser(CONFIG);
        String code = str(op, "code");
        switch (type) {
            case "addMethod" -> {
                TypeDeclaration<?> owner = (TypeDeclaration<?>)n;
                MethodDeclaration method = Methods.parse(code,owner);
                Methods.validate(owner,method,null);
                Methods.fresh(method);
                owner.addMember(method);
                changes.add(obj("operation",type,"nodeId",method.getData(ID),"containerId",owner.getData(ID)));
            }
            case "replaceMethod" -> {
                MethodDeclaration current = (MethodDeclaration)n;
                TypeDeclaration<?> owner = (TypeDeclaration<?>)current.getParentNode().orElseThrow();
                MethodDeclaration method = Methods.parse(code,owner);
                Methods.validate(owner,method,current);
                Methods.fresh(method);
                method.setData(ID,current.getData(ID));
                if (current.getBody().isPresent() && method.getBody().isPresent() && current.getBody().get().toString().equals(method.getBody().get().toString())) method.setBody(current.getBody().get().clone());
                if (method.getComment().isEmpty()) current.getComment().ifPresent(comment -> method.setComment(comment.clone()));
                if (!current.replace(method)) throw new IllegalArgumentException("Не удалось заменить метод.");
                changes.add(obj("operation",type,"nodeId",method.getData(ID),"containerId",owner.getData(ID)));
            }
            case "deleteMethod" -> {
                String containerId = n.getParentNode().orElseThrow().getData(ID);
                if (!n.remove()) throw new IllegalArgumentException("Не удалось удалить метод.");
                changes.add(obj("operation",type,"nodeId",n.getData(ID),"containerId",containerId));
            }
            case "duplicateMethod" -> {
                MethodDeclaration current=(MethodDeclaration)n;
                TypeDeclaration<?> owner=(TypeDeclaration<?>)current.getParentNode().orElseThrow();
                MethodDeclaration copy=current.clone();
                copy.getAnnotations().removeIf(annotation -> Set.of("Override","java.lang.Override").contains(annotation.getNameAsString()));
                String base=current.getNameAsString()+"Copy", candidate=base;
                int suffix=2;
                while (!owner.getMethodsByName(candidate).isEmpty()) candidate=base+suffix++;
                copy.setName(candidate);
                Methods.validate(owner,copy,null);
                Methods.fresh(copy);
                owner.getMembers().add(owner.getMembers().indexOf(current)+1,copy);
                changes.add(obj("operation",type,"nodeId",copy.getData(ID),"containerId",owner.getData(ID)));
            }
            case "updateCondition" -> {
                Expression e = required(parser.parseExpression(code));
                if (n instanceof IfStmt v) v.setCondition(e);
                else if (n instanceof WhileStmt v) v.setCondition(e);
                else if (n instanceof DoStmt v) v.setCondition(e);
                else ((ForStmt)n).setCompare(e);
            }
            case "updateExpression" -> {
                Expression e = required(parser.parseExpression(code));
                if (n instanceof SwitchStmt v) v.setSelector(e);
                else if (n instanceof ExpressionStmt v) v.setExpression(e);
                else if (n instanceof ReturnStmt v) v.setExpression(e);
                else if (n instanceof ThrowStmt v) v.setExpression(e);
                else ((ForEachStmt)n).setIterable(e);
            }
            case "updateVariable" -> {
                List<VariableDeclarator> vars = n instanceof FieldDeclaration f ? f.getVariables() : ((VariableDeclarationExpr)((ExpressionStmt)n).getExpression()).getVariables();
                String name = str(op, "variable");
                if (name.isEmpty() && vars.size() != 1) throw new IllegalArgumentException("Specify variable for a declaration containing multiple variables");
                VariableDeclarator variable = vars.stream().filter(v -> name.isEmpty() || v.getNameAsString().equals(name)).findFirst().orElseThrow(() -> new IllegalArgumentException("Variable not found"));
                variable.setInitializer(required(parser.parseExpression(code)));
            }
            case "replaceStatement" -> {
                Statement replacement = required(parser.parseStatement(code));
                replacement.setData(ID, n.getData(ID));
                if (!n.replace(replacement)) throw new IllegalArgumentException("Cannot replace statement");
            }
            case "deleteBlock" -> { if (!n.remove()) throw new IllegalArgumentException("Cannot delete statement"); }
            case "addBlock", "duplicateBlock" -> {
                Statement added = type.equals("duplicateBlock") ? ((Statement)n).clone() : required(parser.parseStatement(code));
                added.walk(x -> x.setData(ID, UUID.randomUUID().toString()));
                if (n instanceof MethodDeclaration m) insertBeforeExit(m.getBody().orElseThrow().getStatements(),added);
                else if (n instanceof ConstructorDeclaration c) insertBeforeExit(c.getBody().getStatements(),added);
                else if (n instanceof CompactConstructorDeclaration c) insertBeforeExit(c.getBody().getStatements(),added);
                else {
                    NodeList<Statement> siblings = statements(n);
                    int at = siblings.indexOf(n);
                    siblings.add(at+(type.equals("addBlock") && abrupt(n)?0:1), added);
                }
            }
            default -> throw new IllegalArgumentException("Unsupported transform: "+type);
        }
    }
    static boolean abrupt(Node n) { return n instanceof ReturnStmt || n instanceof ThrowStmt || n instanceof BreakStmt || n instanceof ContinueStmt; }
    static void insertBeforeExit(NodeList<Statement> statements, Statement added) {
        int at=statements.size();
        if(at>0 && abrupt(statements.get(at-1))) at--;
        statements.add(at,added);
    }
    static <T> T required(ParseResult<T> parsed) {
        if (!parsed.isSuccessful()) throw new IllegalArgumentException("Invalid Java fragment: "+parsed.getProblems().stream().limit(3).map(p -> p.getLocation().flatMap(TokenRange::toRange).map(r -> "line "+r.begin.line+", column "+r.begin.column+": ").orElse("")+p.getMessage()).collect(java.util.stream.Collectors.joining("\n")));
        return parsed.getResult().orElseThrow();
    }
    Object run(JsonObject request) {
        Map<String,String> known = new HashMap<>();
        if (request.has("identities")) for (JsonElement item : request.getAsJsonArray("identities")) {
            JsonObject identity = item.getAsJsonObject();
            known.put(str(identity,"file")+":"+str(identity,"astPath"),str(identity,"id"));
        }
        for (JsonElement item : request.getAsJsonArray("files")) {
            JsonObject file = item.getAsJsonObject();
            String path = str(file,"path"), content = str(file,"content");
            CompilationUnit cu = parse(path, content);
            if (cu != null) {
                assign(cu, path, "0", known);
                units.add(new Unit(path, content, cu));
            }
        }
        if (!errors.isEmpty()) return obj("files", List.of(), "nodes", List.of(), "edges", List.of(), "identities", List.of(), "structure", List.of(), "warnings", List.of(), "errors", errors);
        JsonArray operations = request.has("operations") ? request.getAsJsonArray("operations") : new JsonArray();
        for (JsonElement operation : operations) {
            transform(operation.getAsJsonObject());
            for (Unit u : units) u.ast.walk(n -> { if (!n.containsData(ID)) n.setData(ID, UUID.randomUUID().toString()); });
            // Reindex the modified tree between operations, keeping attached IDs.
            byId.clear(); paths.clear();
            for (Unit u : units) assign(u.ast, u.path, "0", Collections.emptyMap());
        }
        if (!operations.isEmpty()) {
            // Pretty print from the AST, then reparse and transfer identities in preorder.
            // This refreshes source ranges without deriving semantics from coordinates.
            for (int i=0; i<units.size(); i++) {
                Unit u = units.get(i);
                if (!changedUnits.contains(u.ast)) continue;
                String generated = u.ast.toString();
                CompilationUnit fresh = parse(u.path, generated);
                if (fresh == null) throw new IllegalArgumentException("Generated Java did not reparse");
                List<Node> oldNodes = preorder(u.ast), freshNodes = preorder(fresh);
                if (oldNodes.size() != freshNodes.size()) throw new IllegalArgumentException("AST identity transfer failed");
                for (int j=0; j<oldNodes.size(); j++) {
                    if (!oldNodes.get(j).getClass().equals(freshNodes.get(j).getClass())) throw new IllegalArgumentException("AST identity shape changed");
                    freshNodes.get(j).setData(ID, oldNodes.get(j).getData(ID));
                }
                units.set(i,new Unit(u.path,generated,fresh));
            }
            byId.clear(); paths.clear();
            for (Unit u : units) assign(u.ast,u.path,"0",Collections.emptyMap());
        }
        List<Object> identities = new ArrayList<>(), structure = new ArrayList<>(), files = new ArrayList<>(), containers = new ArrayList<>();
        for (Unit u : units) {
            describe(u.ast,u,null,null,0,0);
            for (TypeDeclaration<?> type : u.ast.findAll(TypeDeclaration.class)) containers.add(Methods.container(type,u.path));
            for (Node n : preorder(u.ast)) identities.add(obj("file",u.path,"astPath",paths.get(n.getData(ID)),"id",n.getData(ID)));
            String pkg = u.ast.getPackageDeclaration().map(p -> p.getNameAsString()).orElse("");
            List<String> mains = new ArrayList<>();
            for (MethodDeclaration method : u.ast.findAll(MethodDeclaration.class)) {
                if (method.isPublic() && method.isStatic() && method.getNameAsString().equals("main") && method.getType().isVoidType() && method.getParameters().size()==1) {
                    Parameter p = method.getParameter(0);
                    String t = p.getType().asString();
                    if (!(t.equals("String[]") || t.equals("java.lang.String[]") || p.isVarArgs() && (t.equals("String") || t.equals("java.lang.String")))) continue;
                    List<String> names = new ArrayList<>();
                    Node ancestor = method.getParentNode().orElse(null);
                    while (ancestor != null) {
                        if (ancestor instanceof TypeDeclaration<?> type) names.add(0,type.getNameAsString());
                        ancestor = ancestor.getParentNode().orElse(null);
                    }
                    mains.add((pkg.isEmpty()?"":pkg+".")+String.join("$",names));
                }
            }
            structure.add(obj("path",u.path,"packageName",pkg,"types",u.ast.getTypes().stream().map(TypeDeclaration::getNameAsString).toList(),"mainClasses",mains));
            files.add(obj("path",u.path,"content",u.content));
            for (MethodDeclaration m : u.ast.findAll(MethodDeclaration.class)) if(shown(m)) m.getBody().ifPresent(b -> edge(m.getData(ID),flow(b,null,null,null),"flow",null));
            for (ConstructorDeclaration c : u.ast.findAll(ConstructorDeclaration.class)) if(shown(c)) edge(c.getData(ID),flow(c.getBody(),null,null,null),"flow",null);
            for (CompactConstructorDeclaration c : u.ast.findAll(CompactConstructorDeclaration.class)) if(shown(c)) edge(c.getData(ID),flow(c.getBody(),null,null,null),"flow",null);
            if (!u.ast.findAll(LambdaExpr.class).isEmpty() || !u.ast.findAll(SwitchExpr.class).isEmpty()) warnings.add("Lambda bodies and switch expressions are preserved in the AST; their internal execution is not expanded into a complete control-flow graph.");
        }
        return obj("files",files,"nodes",nodes,"edges",edges,"identities",identities,"structure",structure,"containers",containers,"changes",changes,"warnings",warnings,"errors",errors);
    }
    public static void main(String[] args) throws Exception {
        try {
            String input = new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
            System.out.print(JSON.toJson(new Engine().run(JsonParser.parseString(input).getAsJsonObject())));
        } catch (Exception e) {
            System.out.print(JSON.toJson(obj("error",e.getMessage()==null?e.getClass().getSimpleName():e.getMessage())));
        }
    }
}

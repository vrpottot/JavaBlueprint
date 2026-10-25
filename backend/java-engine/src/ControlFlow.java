import com.github.javaparser.ast.*;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.stmt.*;
import com.github.javaparser.ast.type.*;
import java.util.*;
import java.util.function.Function;

/** Completion-sensitive intraprocedural CFG. Finally copies never merge pending exits. */
final class ControlFlow {
    record Thrown(String type) {}
    record Jump(String breakTo, String continueTo) {}
    static final class Context {
        String method, scope = "", hint = "", normalExit, exceptionalExit, breakTo, continueTo;
        Function<Node,String> returning;
        Function<Thrown,String> throwing;
        Map<String,Jump> labels = new LinkedHashMap<>();
        Context copy() {
            Context c = new Context(); c.method=method; c.scope=scope; c.normalExit=normalExit;
            c.exceptionalExit=exceptionalExit; c.breakTo=breakTo; c.continueTo=continueTo; c.hint=hint;
            c.returning=returning; c.throwing=throwing; c.labels=new LinkedHashMap<>(labels); return c;
        }
    }
    final Engine engine;
    final Map<String,Map<String,Object>> originals = new LinkedHashMap<>();
    final Map<String,Map<String,Object>> rows = new LinkedHashMap<>();
    final Map<String,String> routes = new HashMap<>();
    final Set<String> finallySources = new HashSet<>();
    final Set<String> generated = new HashSet<>();
    final Map<String,String> parents = new HashMap<>();
    static final Map<String,String> EXCEPTIONS = Map.ofEntries(
        Map.entry("Exception","Throwable"), Map.entry("Error","Throwable"), Map.entry("AssertionError","Error"),
        Map.entry("RuntimeException","Exception"), Map.entry("IOException","Exception"),
        Map.entry("IllegalArgumentException","RuntimeException"), Map.entry("NumberFormatException","IllegalArgumentException"),
        Map.entry("IllegalStateException","RuntimeException"), Map.entry("NullPointerException","RuntimeException"),
        Map.entry("ArithmeticException","RuntimeException"), Map.entry("IndexOutOfBoundsException","RuntimeException"),
        Map.entry("ArrayIndexOutOfBoundsException","IndexOutOfBoundsException"), Map.entry("ClassCastException","RuntimeException"));
    ControlFlow(Engine engine) {
        this.engine=engine;
        for(Map<String,Object> row:engine.nodes) { originals.put((String)row.get("id"),row); rows.put((String)row.get("id"),row); }
        parents.putAll(EXCEPTIONS);
        for(Engine.Unit unit:engine.units) for(ClassOrInterfaceDeclaration type:unit.ast().findAll(ClassOrInterfaceDeclaration.class)) {
            if(!type.getExtendedTypes().isEmpty()) parents.put(type.getNameAsString(),type.getExtendedTypes().get(0).getNameAsString());
        }
    }
    static String simple(String type) { String[] parts=type.split("\\."); return parts[parts.length-1]; }
    String id(Node node, Context c) {
        String origin=node.getData(Engine.ID);
        if(c.scope.isEmpty()) return origin;
        String id="cf:"+origin+":"+Engine.stable(c.scope).replace("-","");
        if(!rows.containsKey(id) && originals.containsKey(origin)) {
            Map<String,Object> row=new LinkedHashMap<>(originals.get(origin));
            row.put("id",id); row.put("originId",origin); row.put("context",c.scope);
            if(!c.hint.isEmpty())row.put("displayCode",c.hint+"\n"+row.getOrDefault("displayCode",row.get("snippet")));
            if(row.get("parentId") instanceof String parent && originals.containsKey(parent)) {
                row.put("parentId","cf:"+parent+":"+Engine.stable(c.scope).replace("-",""));
            }
            rows.put(id,row); engine.nodes.add(row); generated.add(id);
        }
        return id;
    }
    String synthetic(Node source, Context c, String kind, String title, String code, String key) {
        String id="cfg:"+Engine.stable(c.method+":"+source.getData(Engine.ID)+":"+key);
        if(rows.containsKey(id)) return id;
        var range=source.getRange().orElseThrow();
        String file=source.findCompilationUnit().flatMap(cu->engine.units.stream().filter(u->u.ast()==cu).map(Engine.Unit::path).findFirst()).orElse("");
        Map<String,Object> row=Engine.obj("id",id,"astKind",kind,"kind",kind.equals("ResourceGuard")?"condition":kind.equals("Completion")?"return":"operation",
            "title",title,"code",code,"snippet",code,"displayCode",code,"depth",0,"loopDepth",0,
            "methodId",c.method,"editable",List.of(),"synthetic",true,
            "source",Engine.obj("file",file,"startLine",range.begin.line,"endLine",range.end.line,"startColumn",range.begin.column,"endColumn",range.end.column));
        source.findAncestor(TypeDeclaration.class).ifPresent(owner->row.put("containerId",owner.getData(Engine.ID)));
        rows.put(id,row); engine.nodes.add(row); generated.add(id); return id;
    }
    void edge(String from,String to,String kind,String label) { engine.edge(from,to,kind,label); }
    void build(Node callable, BlockStmt body) {
        Context c=new Context(); c.method=callable.getData(Engine.ID);
        c.normalExit=synthetic(callable,c,"Completion","Выход","Завершение метода", "exit");
        c.exceptionalExit=synthetic(callable,c,"Completion","Исключение","Выход с исключением", "throw");
        c.returning=n->c.normalExit; c.throwing=t->c.exceptionalExit;
        edge(c.method,flow(body,c.normalExit,c),"flow",null);
    }
    void finish() {
        // Original finally rows are replaced by context-specific, source-linked copies.
        engine.nodes.removeIf(row->finallySources.contains(row.get("id")));
        Set<String> reachable=new HashSet<>();
        Deque<String> pending=new ArrayDeque<>();
        for(Map<String,Object> row:engine.nodes) if(row.get("kind").equals("method")) pending.add((String)row.get("id"));
        Map<String,List<String>> next=new HashMap<>();
        for(Map<String,Object> edge:engine.edges) next.computeIfAbsent((String)edge.get("source"),x->new ArrayList<>()).add((String)edge.get("target"));
        while(!pending.isEmpty()) { String node=pending.removeFirst(); if(reachable.add(node)) pending.addAll(next.getOrDefault(node,List.of())); }
        engine.nodes.removeIf(row->generated.contains(row.get("id"))&&!reachable.contains(row.get("id")));
        Set<Object> shown=new HashSet<>(); engine.nodes.forEach(row->shown.add(row.get("id")));
        engine.edges.removeIf(edge->!shown.contains(edge.get("source"))||!shown.contains(edge.get("target")));
    }
    String sequence(List<? extends Statement> statements,String next,Context c) {
        String entry=next;
        for(int i=statements.size()-1;i>=0;i--) entry=flow(statements.get(i),entry,c);
        return entry;
    }
    boolean mayThrow(Expression expression) {
        if(expression instanceof LambdaExpr) return false;
        if(expression instanceof VariableDeclarationExpr declaration) return declaration.getVariables().stream().anyMatch(v->v.getInitializer().map(this::mayThrow).orElse(false));
        if(expression instanceof MethodCallExpr || expression instanceof ObjectCreationExpr || expression instanceof ArrayAccessExpr) return true;
        if(expression instanceof SwitchExpr select&&nullableSelector(select.getSelector())&&select.getEntries().stream().flatMap(entry->entry.getLabels().stream()).noneMatch(label->label instanceof NullLiteralExpr))return true;
        if(expression instanceof BinaryExpr binary&&(boxed(binary.getLeft())||boxed(binary.getRight())))return true;
        if(expression instanceof UnaryExpr unary&&boxed(unary.getExpression()))return true;
        if(boxed(expression)) {
            Node parent=expression.getParentNode().orElse(null);
            if(parent instanceof ReturnStmt&&expression.findAncestor(MethodDeclaration.class).map(method->method.getType().isPrimitiveType()).orElse(false))return true;
            if(parent instanceof IfStmt||parent instanceof WhileStmt||parent instanceof DoStmt||parent instanceof ConditionalExpr)return true;
            if(parent instanceof VariableDeclarator variable&&variable.getType().isPrimitiveType())return true;
        }
        if(expression instanceof FieldAccessExpr f && !(f.getScope() instanceof ThisExpr)) return true;
        if(expression instanceof CastExpr cast && !cast.getType().isPrimitiveType()) return true;
        if(expression instanceof SwitchExpr select&&select.getEntries().stream().anyMatch(this::nestedMayThrow))return true;
        if(expression instanceof BinaryExpr b && (b.getOperator()==BinaryExpr.Operator.DIVIDE || b.getOperator()==BinaryExpr.Operator.REMAINDER)) {
            Long divisor=Complexity.integer(b.getRight()); if(divisor==null || divisor==0) return true;
        }
        for(Node child:expression.getChildNodes()) if(child instanceof Expression e && mayThrow(e)) return true;
        return false;
    }
    String expressionType(Expression expression) {
        expression=Complexity.unwrap(expression);
        if(expression instanceof IntegerLiteralExpr)return "int";
        if(expression instanceof CharLiteralExpr)return "char";
        if(expression instanceof CastExpr cast)return cast.getType().asString();
        if(expression instanceof NameExpr name) {
            Node callable=expression.findAncestor(CallableDeclaration.class).orElse(null);
            if(callable!=null) {
                for(Parameter parameter:Symbols.parameters(callable))if(parameter.getNameAsString().equals(name.getNameAsString()))return parameter.getType().asString();
                for(VariableDeclarator variable:callable.findAll(VariableDeclarator.class))if(variable.getNameAsString().equals(name.getNameAsString()))return variable.getType().asString();
            }
            TypeDeclaration<?> owner=Symbols.owner(expression);
            if(owner!=null)return engine.symbols.field(owner.getNameAsString(),name.getNameAsString());
        }
        return "";
    }
    boolean boxed(Expression expression) { return Set.of("Byte","Short","Integer","Long","Float","Double","Boolean","Character").contains(Symbols.raw(expressionType(expression))); }
    boolean nullableSelector(Expression expression) { return !Set.of("byte","short","int","char").contains(expressionType(expression)); }
    boolean nestedMayThrow(Node node) {
        if(node instanceof LambdaExpr||node instanceof TypeDeclaration<?>)return false;
        if(node instanceof ThrowStmt)return true;
        if(node instanceof Expression expression)return mayThrow(expression);
        return node.getChildNodes().stream().anyMatch(this::nestedMayThrow);
    }
    void implicit(String source,Expression expression,Context c) {
        if(mayThrow(expression)) edge(source,c.throwing.apply(new Thrown("?")),"exception","может бросить");
    }
    String flow(Statement statement,String next,Context c) {
        if(statement instanceof BlockStmt b) return sequence(b.getStatements(),next,c);
        String node=id(statement,c);
        if(statement instanceof IfStmt branch) {
            edge(node,flow(branch.getThenStmt(),next,c),"branch","true");
            edge(node,branch.getElseStmt().map(s->flow(s,next,c)).orElse(next),"branch","false");
            implicit(node,branch.getCondition(),c);
        } else if(Engine.loop(statement)) {
            Statement body; Expression condition=null;
            if(statement instanceof ForStmt loop) { body=loop.getBody(); condition=loop.getCompare().orElse(null); for(Expression init:loop.getInitialization()) implicit(node,init,c); for(Expression update:loop.getUpdate()) implicit(node,update,c); }
            else if(statement instanceof ForEachStmt loop) { body=loop.getBody(); implicit(node,loop.getIterable(),c); }
            else if(statement instanceof WhileStmt loop) { body=loop.getBody(); condition=loop.getCondition(); }
            else { DoStmt loop=(DoStmt)statement; body=loop.getBody(); condition=loop.getCondition(); }
            Context inner=c.copy(); inner.breakTo=next; inner.continueTo=node;
            String entry=flow(body,node,inner);
            edge(node,entry,"loop","repeat");
            if(!(statement instanceof ForStmt loop && loop.getCompare().isEmpty())) edge(node,next,"branch","exit");
            if(condition!=null) implicit(node,condition,c);
            return statement instanceof DoStmt?entry:node;
        } else if(statement instanceof SwitchStmt select) {
            String fallthrough=next; boolean hasDefault=false;
            Context inner=c.copy(); inner.breakTo=next;
            for(int i=select.getEntries().size()-1;i>=0;i--) {
                SwitchEntry entry=select.getEntries().get(i);
                String target=sequence(entry.getStatements(),entry.getType()==SwitchEntry.Type.STATEMENT_GROUP?fallthrough:next,inner);
                edge(node,target,"branch",entry.getLabels().isEmpty()?"default":entry.getLabels().toString());
                fallthrough=target; hasDefault|=entry.getLabels().isEmpty();
            }
            if(!hasDefault) edge(node,next,"branch","no match");
            implicit(node,select.getSelector(),c);
            if(nullableSelector(select.getSelector())&&select.getEntries().stream().flatMap(entry->entry.getLabels().stream()).noneMatch(label->label instanceof NullLiteralExpr))edge(node,c.throwing.apply(new Thrown("NullPointerException")),"exception","null selector");
        } else if(statement instanceof TryStmt attempt) {
            tryFlow(attempt,node,next,c);
        } else if(statement instanceof ReturnStmt returned) {
            returned.getExpression().ifPresent(expression->implicit(node,expression,c));
            edge(node,c.returning.apply(returned),"jump","return (значение вычислено)");
        } else if(statement instanceof ThrowStmt thrown) {
            implicit(node,thrown.getExpression(),c);
            String type=thrown.getExpression() instanceof ObjectCreationExpr created?created.getType().getNameAsString():"?";
            edge(node,c.throwing.apply(new Thrown(type)),"exception","throw "+type);
        } else if(statement instanceof BreakStmt stop) {
            String target=stop.getLabel().map(label->c.labels.get(label.asString())).map(Jump::breakTo).orElse(c.breakTo);
            edge(node,target,"jump","break"+stop.getLabel().map(label->" "+label).orElse(""));
        } else if(statement instanceof ContinueStmt again) {
            String target=again.getLabel().map(label->c.labels.get(label.asString())).map(Jump::continueTo).orElse(c.continueTo);
            edge(node,target,"jump","continue"+again.getLabel().map(label->" "+label).orElse(""));
        } else if(statement instanceof LabeledStmt labeled) {
            Context inner=c.copy(); inner.labels.put(labeled.getLabel().asString(),new Jump(next,Engine.loop(labeled.getStatement())?id(labeled.getStatement(),c):null));
            edge(node,flow(labeled.getStatement(),next,inner),"flow","label");
        } else if(statement instanceof SynchronizedStmt monitor) {
            implicit(node,monitor.getExpression(),c);
            edge(node,flow(monitor.getBody(),next,c),"flow","monitor");
        } else if(statement instanceof AssertStmt assertion) {
            implicit(node,assertion.getCheck(),c); assertion.getMessage().ifPresent(message->implicit(node,message,c));
            edge(node,c.throwing.apply(new Thrown("AssertionError")),"exception","assert: ошибка при включённых assertions");
            edge(node,next,"flow","assert: успех или assertions отключены");
        } else {
            if(statement instanceof ExpressionStmt expression) implicit(node,expression.getExpression(),c);
            if(statement instanceof ExplicitConstructorInvocationStmt)edge(node,c.throwing.apply(new Thrown("?")),"exception","ошибка конструктора");
            edge(node,next,"flow",null);
        }
        return node;
    }
    String finalRoute(TryStmt attempt,String destination,String reason,Context outer) {
        if(attempt.getFinallyBlock().isEmpty()) return destination;
        BlockStmt body=attempt.getFinallyBlock().get();
        for(Node n:body.findAll(Node.class)) if(n.containsData(Engine.ID)&&originals.containsKey(n.getData(Engine.ID))) {
            Map<String,Object> row=originals.get(n.getData(Engine.ID));
            if(outer.method.equals(row.get("methodId"))&&!row.get("astKind").equals("FieldDeclaration"))finallySources.add(n.getData(Engine.ID));
        }
        String key="finally:"+id(attempt,outer)+":"+destination+":"+reason;
        if(routes.containsKey(key)) return routes.get(key);
        Context c=outer.copy(); c.scope=key; c.hint="finally · "+reason;
        String resume=synthetic(attempt,c,"Resume","Продолжить "+reason,"Продолжить "+reason+" после finally",key+":resume");
        rows.get(resume).put("completion",reason);
        edge(resume,destination,"resume",reason);
        String entry=flow(body,resume,c); routes.put(key,entry); return entry;
    }
    void tryFlow(TryStmt attempt,String node,String next,Context outer) {
        Function<String,String> finish=reason->finalRoute(attempt,next,reason,outer);
        String normal=finish.apply("normal");
        Context outside=outer.copy();
        outside.returning=origin->finalRoute(attempt,outer.returning.apply(origin),"return L"+origin.getBegin().orElseThrow().line,outer);
        outside.throwing=thrown->finalRoute(attempt,outer.throwing.apply(thrown),"throw "+thrown.type,outer);
        outside.breakTo=outer.breakTo==null?null:finalRoute(attempt,outer.breakTo,"break",outer);
        outside.continueTo=outer.continueTo==null?null:finalRoute(attempt,outer.continueTo,"continue",outer);
        outside.labels.replaceAll((label,target)->new Jump(
            target.breakTo==null?null:finalRoute(attempt,target.breakTo,"break "+label,outer),
            target.continueTo==null?null:finalRoute(attempt,target.continueTo,"continue "+label,outer)));
        List<String> catches=new ArrayList<>();
        for(CatchClause caught:attempt.getCatchClauses()) {
            String catchNode=synthetic(caught,outer,"Catch","catch "+caught.getParameter().getType(),caught.getParameter().toString(),"catch:"+id(attempt,outer)+":"+caught.getData(Engine.ID));
            edge(catchNode,flow(caught.getBody(),normal,outside),"flow",null); catches.add(catchNode);
        }
        Context body=outside.copy();
        body.throwing=thrown->{
            if(catches.isEmpty()) return outside.throwing.apply(thrown);
            String key="dispatch:"+id(attempt,outer)+":"+thrown.type;
            if(routes.containsKey(key)) return routes.get(key);
            String dispatch=synthetic(attempt,outer,"ExceptionDispatch","Выбор catch","Исключение "+thrown.type+": первый совместимый catch",key);
            routes.put(key,dispatch); boolean handled=false;
            for(int i=0;i<catches.size();i++) {
                Type type=attempt.getCatchClauses().get(i).getParameter().getType();
                int match=matches(thrown.type,type);
                if(match!=0) edge(dispatch,catches.get(i),"exception",type+" (первый подходящий)");
                if(match==1) { handled=true; break; }
            }
            if(!handled) edge(dispatch,outside.throwing.apply(thrown),"exception","не перехвачено");
            return dispatch;
        };
        String entry=resources(attempt,0,normal,body);
        edge(node,entry,"flow","try");
    }
    int matches(String thrown,Type caught) {
        List<Type> types=caught instanceof UnionType union?new ArrayList<>(union.getElements()):List.of(caught);
        boolean uncertain=false;
        for(Type type:types) {
            String expected=simple(type.asString());
            if(expected.equals("Throwable")) return 1;
            if(thrown.equals("?")) { uncertain=true; continue; }
            String current=simple(thrown); Set<String> seen=new HashSet<>();
            while(seen.add(current)) {
                if(current.equals(expected)) return 1;
                if(!parents.containsKey(current)) { if(!current.equals("Throwable")) uncertain=true; break; }
                current=parents.get(current);
            }
        }
        return uncertain?-1:0;
    }
    String resources(TryStmt attempt,int index,String next,Context outer) {
        if(index==attempt.getResources().size()) return flow(attempt.getTryBlock(),next,outer);
        Expression resource=attempt.getResources().get(index);
        String name=resource instanceof VariableDeclarationExpr declaration?declaration.getVariable(0).getNameAsString():resource.toString();
        Context inner=outer.copy();
        inner.returning=origin->close(resource,name,outer.returning.apply(origin),"return",null,outer);
        inner.throwing=thrown->close(resource,name,outer.throwing.apply(thrown),"throw",thrown,outer);
        inner.breakTo=outer.breakTo==null?null:close(resource,name,outer.breakTo,"break",null,outer);
        inner.continueTo=outer.continueTo==null?null:close(resource,name,outer.continueTo,"continue",null,outer);
        inner.labels.replaceAll((label,target)->new Jump(target.breakTo==null?null:close(resource,name,target.breakTo,"break "+label,null,outer),
            target.continueTo==null?null:close(resource,name,target.continueTo,"continue "+label,null,outer)));
        String normal=close(resource,name,next,"normal",null,outer);
        String following=resources(attempt,index+1,normal,inner);
        String init=synthetic(resource,outer,"ResourceInit","Открыть "+name,resource.toString(),"init:"+id(attempt,outer)+":"+index);
        edge(init,following,"flow","успех");
        if(mayThrow(resource)) edge(init,outer.throwing.apply(new Thrown("?")),"exception","ошибка инициализации");
        return init;
    }
    String close(Expression resource,String name,String destination,String reason,Thrown primary,Context outer) {
        String key="close:"+resource.getData(Engine.ID)+":"+outer.scope+":"+destination+":"+reason+":"+(primary==null?"none":primary.type);
        if(routes.containsKey(key)) return routes.get(key);
        String guard=synthetic(resource,outer,"ResourceGuard",name+" != null",name+" != null",key+":guard");
        routes.put(key,guard);
        String close=synthetic(resource,outer,"ResourceClose","Закрыть "+name,name+".close()",key);
        rows.get(close).put("resource",name); rows.get(close).put("completion",reason);
        Expression initializer=resource instanceof VariableDeclarationExpr declaration?declaration.getVariable(0).getInitializer().orElse(null):null;
        if(!(initializer instanceof NullLiteralExpr))edge(guard,close,"branch","true");
        if(!(initializer instanceof ObjectCreationExpr))edge(guard,destination,"branch","false");
        edge(close,destination,"flow","close: успех");
        if(primary==null) edge(close,outer.throwing.apply(new Thrown("?")),"exception","close: новое исключение");
        else {
            String suppressed=synthetic(resource,outer,"Suppressed","Сохранить primary","primary.addSuppressed(closeError)",key+":suppressed");
            edge(close,suppressed,"exception","close: ошибка при primary"); edge(suppressed,destination,"resume","исходное исключение");
            edge(suppressed,outer.throwing.apply(new Thrown("IllegalArgumentException")),"exception","self-suppression: closeError == primary");
        }
        return guard;
    }
}

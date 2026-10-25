import com.github.javaparser.ast.*;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.stmt.*;
import java.util.*;

/** Conservative, compositional upper bounds for a deliberately supported AST subset. */
final class Complexity {
    static final int TERM_LIMIT = 64;
    record Powers(int linear, int logarithmic) {}
    record Term(SortedMap<String,Powers> factors) {
        static Term one() { return new Term(new TreeMap<>()); }
        static Term variable(String name, boolean log) {
            SortedMap<String,Powers> map = new TreeMap<>();
            map.put(name, new Powers(log ? 0 : 1, log ? 1 : 0));
            return new Term(map);
        }
        Term multiply(Term other) {
            SortedMap<String,Powers> map = new TreeMap<>(factors);
            other.factors.forEach((key,p) -> map.merge(key,p,(a,b) -> new Powers(a.linear+b.linear,a.logarithmic+b.logarithmic)));
            return new Term(map);
        }
        boolean dominates(Term other) {
            for (var entry : other.factors.entrySet()) {
                Powers a = factors.getOrDefault(entry.getKey(),new Powers(0,0)), b = entry.getValue();
                if (a.linear < b.linear || a.linear == b.linear && a.logarithmic < b.logarithmic) return false;
            }
            return true;
        }
        String format() {
            List<String> parts = new ArrayList<>();
            factors.forEach((name,p) -> {
                if(p.linear > 0) parts.add(name+(p.linear > 1 ? "^"+p.linear : ""));
                if(p.logarithmic > 0) parts.add("log("+name+")"+(p.logarithmic > 1 ? "^"+p.logarithmic : ""));
            });
            return parts.isEmpty() ? "1" : String.join(" * ",parts);
        }
    }
    record Cost(List<Term> terms, boolean unknown) {
        static Cost one() { return new Cost(List.of(Term.one()),false); }
        static Cost unknownCost() { return new Cost(List.of(),true); }
        static Cost variable(String name) { return new Cost(List.of(Term.variable(name,false)),false); }
        static Cost normalize(List<Term> input) {
            List<Term> terms = new ArrayList<>();
            for(Term t : input) {
                if(terms.stream().anyMatch(x -> x.dominates(t))) continue;
                terms.removeIf(t::dominates); terms.add(t);
                if(terms.size() > TERM_LIMIT) return unknownCost();
            }
            terms.sort(Comparator.comparing(Term::format));
            return new Cost(terms.isEmpty()?List.of(Term.one()):terms,false);
        }
        Cost plus(Cost other) {
            if(unknown || other.unknown) return unknownCost();
            List<Term> all = new ArrayList<>(terms); all.addAll(other.terms); return normalize(all);
        }
        Cost times(Cost other) {
            if(unknown || other.unknown) return unknownCost();
            List<Term> products = new ArrayList<>();
            for(Term a : terms) for(Term b : other.terms) products.add(a.multiply(b));
            return normalize(products);
        }
        Cost logarithm() {
            if(unknown) return unknownCost();
            if(terms.size()>1)return Cost.variable("("+String.join(" + ",terms.stream().map(Term::format).toList())+")").logarithm();
            List<Term> logs = new ArrayList<>();
            for(Term term : terms) for(String name : term.factors.keySet()) logs.add(Term.variable(name,true));
            return normalize(logs);
        }
        String format() { return unknown ? "unknown" : "O("+String.join(" + ",terms.stream().map(Term::format).toList())+")"; }
    }
    static final class Context {
        final Map<String,String> types = new HashMap<>();
        final Map<String,Cost> sizes = new HashMap<>();
        final Map<String,Expression> initializers = new HashMap<>();
        final Map<String,String> concrete = new HashMap<>();
        final Map<String,Long> maximum = new HashMap<>();
        final Set<String> positive = new HashSet<>();
        final Map<String,Cost> growth = new HashMap<>();
        final Map<String,Cost> linearReads = new HashMap<>();
        final Set<String> immutableGrowth = new HashSet<>();
        final Map<String,Cost> chains = new HashMap<>();
        final Map<String,String> roots = new HashMap<>();
        TypeDeclaration<?> owner;
        String receiver = "";
        Cost returned = Cost.one();
        boolean sawReturn;
        Context copy() {
            Context c = new Context(); c.types.putAll(types); c.sizes.putAll(sizes); c.initializers.putAll(initializers); c.concrete.putAll(concrete); c.maximum.putAll(maximum); c.positive.addAll(positive); c.growth.putAll(growth); c.immutableGrowth.addAll(immutableGrowth); c.chains.putAll(chains); c.roots.putAll(roots); c.owner=owner; c.receiver=receiver; c.returned=returned; c.sawReturn=sawReturn; return c;
        }
    }
    final Node root;
    final Symbols symbols;
    final Set<Node> stack = Collections.newSetFromMap(new IdentityHashMap<>());
    final Set<Node> recursiveUnit = Collections.newSetFromMap(new IdentityHashMap<>());
    final LinkedHashSet<String> assumptions = new LinkedHashSet<>();
    final LinkedHashSet<String> limitations = new LinkedHashSet<>();
    final List<Map<String,Object>> evidence = new ArrayList<>();
    int calls = 0;
    Complexity(Node method, Symbols symbols) { root = method; this.symbols=symbols; }
    static Map<String,Object> inspect(Node method, Symbols symbols) {
        try { return new Complexity(method,symbols).inspect(); }
        catch(RuntimeException failure) {
            if("1".equals(System.getenv("JBP_ENGINE_DEBUG")))failure.printStackTrace(System.err);
            return Engine.obj("estimate","unknown","status","unknown","kind","upper_bound","confidence","unknown","assumptions",List.of(),"limitations",List.of("Оценка этого метода недоступна: "+failure.getClass().getSimpleName()),"explanation","Модель не смогла обработать это сочетание конструкций; исходный код и граф сохранены.","evidence",List.of());
        }
    }
    Map<String,Object> inspect() {
        assumptions.add("Размеры входов неотрицательны; оценивается верхняя граница времени в модели постоянной стоимости примитивных операций.");
        Context c = context(Symbols.owner(root),"",Symbols.owner(root)==null?"":Symbols.owner(root).getNameAsString());
        for(Parameter p : Symbols.parameters(root)) {
            String name=p.getNameAsString(), type=p.getType().asString();
            c.types.put(name,type); c.sizes.put(name,Cost.variable(numeric(type)?name:"|"+name+"|"));
        }
        stack.add(root);
        Cost result = callable(root,c);
        if(result.unknown && limitations.isEmpty()) limitations.add("Символьное выражение превысило лимит сложности анализа.");
        return Engine.obj("estimate",result.format(),"status",result.unknown?"unknown":"estimated","kind","upper_bound",
            "confidence",result.unknown?"unknown":"conditional","assumptions",assumptions,"limitations",limitations,
            "explanation",result.unknown?"Полная оценка неизвестна: "+String.join(" ",limitations):result.format()+" — верхняя граница для распознанных конструкций при указанных предположениях.","evidence",evidence);
    }
    Context context(TypeDeclaration<?> owner,String receiver) { return context(owner,receiver,owner==null?"":owner.getNameAsString()); }
    Context context(TypeDeclaration<?> owner,String receiver,String actual) {
        Context c=new Context(); c.owner=owner; c.receiver=receiver;
        if(owner==null)return c;
        for(FieldDeclaration field:owner.getFields()) for(VariableDeclarator variable:field.getVariables()) {
            String name=variable.getNameAsString(), type=symbols.bind(variable.getType().asString(),owner,actual); c.types.put(name,type);
            c.sizes.put(name,Cost.variable(numeric(type)?receiver+name:"|"+receiver+name+"|"));
            if(field.isFinal()&&variable.getInitializer().orElse(null) instanceof ObjectCreationExpr created)c.concrete.put(name,created.getType().asString());
            if(field.isFinal()&&!c.concrete.containsKey(name)) {
                Set<String> assigned=new HashSet<>();
                for(ConstructorDeclaration constructor:owner.getConstructors())for(AssignExpr assignment:constructor.findAll(AssignExpr.class))if(assignment.getTarget().toString().equals(name)||assignment.getTarget().toString().equals("this."+name))assigned.add(assignment.getValue() instanceof ObjectCreationExpr created?created.getType().asString():"<unknown>");
                if(assigned.size()==1&&!assigned.contains("<unknown>"))c.concrete.put(name,assigned.iterator().next());
            }
            if(field.isFinal()&&variable.getInitializer().isPresent()&&integer(variable.getInitializer().get())!=null) { c.sizes.put(name,Cost.one()); c.maximum.put(name,integer(variable.getInitializer().get())); }
        }
        if(owner instanceof RecordDeclaration record) for(Parameter component:record.getParameters()) {
            c.types.put(component.getNameAsString(),symbols.bind(component.getType().asString(),owner,actual));
            c.sizes.put(component.getNameAsString(),Cost.variable(numeric(component.getType().asString())?receiver+component.getNameAsString():"|"+receiver+component.getNameAsString()+"|"));
        }
        if(owner instanceof ClassOrInterfaceDeclaration declaration)for(var parameter:declaration.getTypeParameters())c.types.put(parameter.getNameAsString(),parameter.getTypeBound().isEmpty()?"Object":parameter.getTypeBound().get(0).asString());
        return c;
    }
    Cost unknown(Node node, String reason) {
        if(limitations.size()<12) limitations.add("L"+node.getBegin().map(p->p.line).orElse(1)+": "+reason);
        return Cost.unknownCost();
    }
    void explain(Node n, Cost cost, String rule) {
        if(evidence.size()<100) evidence.add(Engine.obj("line",n.getBegin().map(p->p.line).orElse(1),"nodeId",n.containsData(Engine.ID)?n.getData(Engine.ID):"","estimate",cost.format(),"rule",rule));
    }
    static Expression unwrap(Expression e) { while(e instanceof EnclosedExpr p) e=p.getInner(); return e; }
    static Long integer(Expression raw) {
        Expression e=unwrap(raw);
        try {
            if(e instanceof IntegerLiteralExpr v) return v.asNumber().longValue();
            if(e instanceof LongLiteralExpr v) return v.asNumber().longValue();
            if(e instanceof UnaryExpr u && u.getOperator()==UnaryExpr.Operator.MINUS) { Long n=integer(u.getExpression()); return n==null?null:-n; }
        } catch(RuntimeException ignored) { }
        return null;
    }
    static boolean numeric(String type) { return Set.of("byte","short","int","long","float","double","char","boolean","Byte","Short","Integer","Long","Float","Double","Character","Boolean").contains(type); }
    static String baseType(String type) { return Symbols.raw(type); }
    static boolean collection(String type) { return Set.of("List","Set","Map","Collection","Iterable","ArrayList","LinkedList","HashSet","LinkedHashSet","TreeSet","HashMap","LinkedHashMap","TreeMap","EnumMap","Deque","ArrayDeque","Queue","PriorityQueue","Stream","IntStream","LongStream").contains(baseType(type)); }
    String typeOf(Expression e, Context c) {
        e=unwrap(e);
        if(e instanceof ArrayAccessExpr a) { String array=typeOf(a.getName(),c); return array.endsWith("[]")?array.substring(0,array.length()-2):""; }
        if(e instanceof NameExpr n) { String type=c.types.getOrDefault(n.getNameAsString(),symbols.type(n.getNameAsString())!=null?n.getNameAsString():""); return c.types.containsKey(type)?c.types.get(type):type; }
        if(e instanceof ThisExpr)return c.owner==null?"":c.owner.getNameAsString();
        if(e instanceof StringLiteralExpr || e instanceof TextBlockLiteralExpr)return "String";
        if(e instanceof IntegerLiteralExpr)return "int";
        if(e instanceof LongLiteralExpr)return "long";
        if(e instanceof BooleanLiteralExpr)return "boolean";
        if(e instanceof CharLiteralExpr)return "char";
        if(e instanceof CastExpr cast)return cast.getType().asString();
        if(e instanceof ObjectCreationExpr created)return created.getType().asString();
        if(e instanceof ArrayCreationExpr array)return array.getElementType().asString()+"[]".repeat(array.getLevels().size());
        if(e instanceof UnaryExpr unary)return typeOf(unary.getExpression(),c);
        if(e instanceof ConditionalExpr conditional)return typeOf(conditional.getThenExpr(),c);
        if(e instanceof BinaryExpr binary)return typeOf(binary.getLeft(),c).equals("String")||typeOf(binary.getRight(),c).equals("String")?"String":typeOf(binary.getLeft(),c);
        if(e instanceof TypeExpr type)return type.getType().asString();
        if(e instanceof FieldAccessExpr field) {
            if(field.getNameAsString().equals("length"))return "int";
            String owner=typeOf(field.getScope(),c); TypeDeclaration<?> declaration=symbols.type(owner);
            if(declaration instanceof EnumDeclaration)return owner;
            return symbols.field(owner,field.getNameAsString());
        }
        if(e instanceof MethodCallExpr call) {
            String receiver=call.getScope().map(scope->typeOf(scope,c)).orElse(c.owner==null?"":c.owner.getNameAsString());
            String name=call.getNameAsString(), raw=baseType(receiver), scope=call.getScope().map(Object::toString).orElse("");
            TypeDeclaration<?> owner=symbols.type(receiver);
            if(owner instanceof RecordDeclaration) { String component=symbols.field(receiver,name); if(!component.isEmpty()&&call.getArguments().isEmpty())return component; }
            MethodDeclaration method=symbols.method(receiver,name,call.getArguments().stream().map(arg->typeOf(arg,c)).toList());
            if(method!=null)return symbols.bind(method.getType().asString(),Symbols.owner(method),receiver);
            if(name.equals("getKey"))return Symbols.argument(receiver,0);
            if(name.equals("getValue"))return Symbols.argument(receiver,1);
            if(name.equals("clone"))return receiver;
            if(Set.of("size","length","indexOf","ordinal","nextInt","parseInt","intValue").contains(name))return "int";
            if(Set.of("nextLong","parseLong","longValue","toUnsignedLong").contains(name))return "long";
            if(Set.of("isEmpty","isBlank","contains","containsKey","containsValue","equals","test","allMatch","anyMatch").contains(name))return "boolean";
            if(name.equals("entrySet"))return "Set<Entry<"+Symbols.argument(receiver,0)+","+Symbols.argument(receiver,1)+">>";
            if(name.equals("values"))return owner instanceof EnumDeclaration?receiver+"[]":"Collection<"+Symbols.argument(receiver,1)+">";
            if(name.equals("keySet"))return "Set<"+Symbols.argument(receiver,0)+">";
            if(Set.of("get","getOrDefault","computeIfAbsent","compute","merge","getFirst","getLast","peek","peekFirst","peekLast","poll","remove","removeFirst","removeLast").contains(name))return Symbols.argument(receiver,raw.contains("Map")?1:0);
            if(name.equals("stream"))return "Stream<"+Symbols.argument(receiver,0)+">";
            if(Set.of("filter","sorted","limit","skip","distinct").contains(name))return receiver;
            if(Set.of("reversed","thenComparing","thenComparingInt","thenComparingLong").contains(name)||scope.equals("Comparator"))return "Comparator<Object>";
            if(name.equals("mapToInt"))return "IntStream";
            if(name.equals("mapToLong"))return "LongStream";
            if(name.equals("toList"))return "List<"+Symbols.argument(receiver,0)+">";
            if(name.equals("collect"))return call.getArguments().stream().anyMatch(argument->argument instanceof MethodCallExpr collector&&collector.getNameAsString().equals("joining")&&collector.getScope().map(Object::toString).orElse("").endsWith("Collectors"))?"String":"ArrayList<"+Symbols.argument(receiver,0)+">";
            if(name.equals("toArray"))return raw.equals("IntStream")?"int[]":"Object[]";
            if(Set.of("max","min","average").contains(name)&&Set.of("IntStream","LongStream","DoubleStream").contains(raw))return raw.equals("IntStream")?"OptionalInt":raw.equals("LongStream")?"OptionalLong":"OptionalDouble";
            if(Set.of("findFirst","findAny","max","min").contains(name)&&raw.equals("Stream"))return "Optional<"+Symbols.argument(receiver,0)+">";
            if(name.equals("map")) {
                String result="Object";
                if(!call.getArguments().isEmpty()&&call.getArgument(0) instanceof LambdaExpr lambda) {
                    Context body=lambdaContext(lambda,receiver,c);
                    if(lambda.getBody() instanceof ExpressionStmt expression)result=typeOf(expression.getExpression(),body);
                }
                return "Stream<"+result+">";
            }
            if(Set.of("List","Set","Map","Optional").contains(scope)&&Set.of("of","ofNullable","empty","copyOf").contains(name)) {
                if(name.equals("copyOf")&&!call.getArguments().isEmpty())return typeOf(call.getArgument(0),c);
                return scope+"<"+(call.getArguments().isEmpty()?"Object":typeOf(call.getArgument(0),c))+">";
            }
            if(raw.equals("StringBuilder")&&Set.of("append","appendCodePoint","delete","deleteCharAt","reverse").contains(name))return receiver;
            if(Set.of("toString","toUnsignedString","substring","strip","trim","name","toLowerCase","toUpperCase","getSimpleName","getMessage","readLine","joining","join","render","format").contains(name))return "String";
            if(name.equals("split"))return "String[]";
            if(name.equals("getClass"))return "Class";
            if(name.equals("getSuppressed"))return "Throwable[]";
            if(name.equals("orElseThrow")||name.equals("orElse")||name.equals("orElseGet"))return raw.equals("OptionalInt")?"int":raw.equals("OptionalLong")?"long":raw.equals("OptionalDouble")?"double":Symbols.argument(receiver,0);
        }
        return "";
    }
    Cost length(Expression e, Context c) {
        e=unwrap(e);
        if(e instanceof BinaryExpr binary && typeOf(e,c).equals("String"))return textLength(binary.getLeft(),c).plus(textLength(binary.getRight(),c));
        if(e instanceof StringLiteralExpr || e instanceof TextBlockLiteralExpr)return Cost.one();
        if(e instanceof ObjectCreationExpr created&&collection(created.getType().asString()))return size(created,c);
        if(baseType(typeOf(e,c)).equals("EnumMap"))return Cost.one();
        if(e instanceof ArrayAccessExpr a && typeOf(e,c).endsWith("[]")) {
            Expression base=a.getName(); String suffix="[]";
            while(base instanceof ArrayAccessExpr inner) { base=inner.getName(); suffix+="[]"; }
            if(base instanceof NameExpr name) {
                assumptions.add("Для многомерного массива используется максимальная длина вложенной строки; строки могут иметь разную длину.");
                return Cost.variable("max(|"+name.getNameAsString()+suffix+"|)");
            }
        }
        if(typeOf(e,c).endsWith("[]") || collection(typeOf(e,c)) || Set.of("String","StringBuilder").contains(baseType(typeOf(e,c)))) {
            if(collection(typeOf(e,c))) assumptions.add("Коллекции используют стандартные реализации JDK; пользовательские переопределения и конкурентные изменения не моделируются.");
            if(e instanceof MethodCallExpr call) {
                if(call.getScope().isEmpty()&&c.owner!=null) {
                    MethodDeclaration method=symbols.method(c.owner.getNameAsString(),call.getNameAsString(),call.getArguments().stream().map(argument->typeOf(argument,c)).toList());
                    if(method!=null&&!sizing.contains(method))return returnSize(call,c);
                }
                if(call.getScope().isPresent()&&symbols.type(typeOf(call.getScope().get(),c)) instanceof EnumDeclaration&&Set.of("name","toString").contains(call.getNameAsString()))return Cost.one();
                if(call.getNameAsString().equals("values")&&call.getScope().isPresent()&&symbols.type(typeOf(call.getScope().get(),c)) instanceof EnumDeclaration)return Cost.one();
                if(call.getScope().map(Object::toString).orElse("").matches("List|Set|Map")&&Set.of("of","empty").contains(call.getNameAsString()))return Cost.one();
                if(call.getNameAsString().equals("collect")&&baseType(typeOf(call,c)).equals("String")&&call.getScope().isPresent())return length(call.getScope().get(),c).times(Cost.variable("max(|stream text element|)")).plus(call.getArguments().stream().flatMap(arg->arg.findAll(StringLiteralExpr.class).stream()).findAny().isPresent()?length(call.getScope().get(),c):Cost.one());
                if(call.getScope().isPresent() && (collection(typeOf(call.getScope().get(),c))||typeOf(call.getScope().get(),c).endsWith("[]")) && Set.of("values","keySet","entrySet","stream","toList","toArray","filter","map","mapToInt","mapToLong","sorted","clone","collect").contains(call.getNameAsString()))return length(call.getScope().get(),c);
                if(call.getScope().isPresent()&&symbols.type(typeOf(call.getScope().get(),c))!=null) {
                    MethodDeclaration method=symbols.method(typeOf(call.getScope().get(),c),call.getNameAsString(),call.getArguments().stream().map(argument->typeOf(argument,c)).toList());
                    if(method!=null&&!sizing.contains(method))return returnSize(call,c);
                }
                if(call.getScope().map(Object::toString).orElse("").matches("List|Set")&&call.getNameAsString().equals("copyOf"))return length(call.getArgument(0),c);
                if(call.getScope().isPresent()&&Set.of("append","appendCodePoint").contains(call.getNameAsString()))return length(call.getScope().get(),c).plus(call.getArguments().isEmpty()?Cost.one():textLength(call.getArgument(0),c));
                if(call.getScope().isPresent()&&Set.of("toString","strip","trim","substring","split","toLowerCase","toUpperCase").contains(call.getNameAsString()))return length(call.getScope().get(),c);
            }
            Cost alias=c.sizes.get(e instanceof FieldAccessExpr field&&field.getScope() instanceof ThisExpr?field.getNameAsString():e.toString());
            // For arrays/collections, parameter symbols represent lengths, not object addresses.
            return alias==null?Cost.variable("|"+e+"|"):alias;
        }
        return Cost.unknownCost();
    }
    Cost size(Expression raw, Context c) {
        Expression e=unwrap(raw);
        if(e instanceof CastExpr cast) return size(cast.getExpression(),c);
        if(e instanceof UnaryExpr unary && (unary.getOperator()==UnaryExpr.Operator.MINUS || unary.getOperator()==UnaryExpr.Operator.PLUS)) {
            assumptions.add("Числовые размеры в оценке обозначают модуль значения.");
            return size(unary.getExpression(),c);
        }
        if(e instanceof ConditionalExpr conditional) return size(conditional.getThenExpr(),c).plus(size(conditional.getElseExpr(),c));
        if(e instanceof SwitchExpr select) {
            Cost result=Cost.one();
            for(SwitchEntry entry:select.getEntries()) {
                Context branch=c.copy(); bindPatterns(entry,branch);
                for(Statement statement:entry.getStatements()) {
                    if(statement instanceof BlockStmt)statement(statement,branch);
                    if(statement instanceof ExpressionStmt value)result=result.plus(typeOf(value.getExpression(),branch).equals("String")?textLength(value.getExpression(),branch):size(value.getExpression(),branch));
                    for(YieldStmt yielded:statement.findAll(YieldStmt.class))result=result.plus(typeOf(yielded.getExpression(),branch).equals("String")?textLength(yielded.getExpression(),branch):size(yielded.getExpression(),branch));
                }
            }
            return result;
        }
        if(integer(e)!=null || e instanceof BooleanLiteralExpr || e instanceof CharLiteralExpr) return Cost.one();
        if(e instanceof StringLiteralExpr || e instanceof TextBlockLiteralExpr)return Cost.one();
        if(e instanceof NameExpr n) return c.sizes.getOrDefault(n.getNameAsString(),Cost.unknownCost());
        if(e instanceof ArrayAccessExpr access)return Cost.variable("max(|"+access.getName()+"[*]|)");
        if(e instanceof ObjectCreationExpr created) {
            if(collection(created.getType().asString()))return created.getArguments().isEmpty()?Cost.one():collection(typeOf(created.getArgument(0),c))||typeOf(created.getArgument(0),c).endsWith("[]")?length(created.getArgument(0),c):Cost.one();
            if(created.getType().getNameAsString().equals("StringBuilder"))return Cost.one();
            if(created.getType().getNameAsString().equals("StringReader")&&!created.getArguments().isEmpty())return length(created.getArgument(0),c);
            if(created.getType().getNameAsString().equals("BufferedReader")&&!created.getArguments().isEmpty())return size(created.getArgument(0),c);
        }
        if(e instanceof FieldAccessExpr field && !field.getNameAsString().equals("length"))return Cost.variable(numeric(typeOf(e,c))?e.toString():"|"+e+"|");
        if(e instanceof ArrayCreationExpr a && !a.getLevels().isEmpty() && a.getLevels().get(0).getDimension().isPresent()) return size(a.getLevels().get(0).getDimension().get(),c);
        if(e instanceof FieldAccessExpr f && f.getNameAsString().equals("length") && typeOf(f.getScope(),c).endsWith("[]")) return length(f.getScope(),c);
        if(e instanceof MethodCallExpr call && call.getArguments().isEmpty() && call.getScope().isPresent() && Set.of("size","length").contains(call.getNameAsString()) && (collection(typeOf(call.getScope().get(),c))||Set.of("String","StringBuilder").contains(baseType(typeOf(call.getScope().get(),c))))) return length(call.getScope().get(),c);
        if(e instanceof MethodCallExpr call) return returnSize(call,c);
        if(e instanceof BinaryExpr b) {
            Cost a=size(b.getLeft(),c), z=size(b.getRight(),c);
            return switch(b.getOperator()) {
                case PLUS,MINUS -> a.plus(z);
                case MULTIPLY -> a.times(z);
                case DIVIDE -> integer(b.getRight())!=null && integer(b.getRight())>0 ? a : Cost.unknownCost();
                default -> Cost.unknownCost();
            };
        }
        return Cost.unknownCost();
    }
    Cost callable(Node method, Context c) {
        if(method instanceof MethodDeclaration m) {
            if(m.getBody().isEmpty()) { Cost closed=sealedAccessor(m); return closed==null?unknown(m,"Метод не имеет тела; открытые реализации требуют внешнего контракта."):closed; }
            if(!recursiveUnit.contains(m)) { Cost recurrence=AlgorithmRules.recursion(this,m,c); if(recurrence!=null)return recurrence; }
            return statement(m.getBody().get(),c);
        }
        if(method instanceof ConstructorDeclaration constructor) {
            Cost cost=Cost.one(); if(c.owner!=null)for(FieldDeclaration field:c.owner.getFields())if(!field.isStatic())for(VariableDeclarator variable:field.getVariables())if(variable.getInitializer().isPresent())cost=cost.plus(expression(variable.getInitializer().get(),c));
            return cost.plus(statement(constructor.getBody(),c));
        }
        if(method instanceof CompactConstructorDeclaration constructor)return statement(constructor.getBody(),c);
        return unknown(method,"Тело объявления недоступно.");
    }
    Cost sealedAccessor(MethodDeclaration method) {
        if(!(Symbols.owner(method) instanceof ClassOrInterfaceDeclaration owner)||owner.getPermittedTypes().isEmpty()||!method.getParameters().isEmpty())return null;
        for(var permitted:owner.getPermittedTypes()) {
            TypeDeclaration<?> subtype=symbols.type(permitted.asString());
            if(!(subtype instanceof RecordDeclaration)||symbols.field(permitted.asString(),method.getNameAsString()).isEmpty())return null;
        }
        assumptions.add("Закрытая sealed-иерархия: все разрешённые реализации этого accessor — компоненты record с O(1) доступом.");return Cost.one();
    }
    Cost statement(Statement s, Context c) {
        if(s instanceof BlockStmt b) {
            Cost total=Cost.one();
            for(Statement child : b.getStatements()) { total=total.plus(statement(child,c)); if(child instanceof ReturnStmt || child instanceof ThrowStmt) break; }
            return total;
        }
        if(s instanceof EmptyStmt || s instanceof BreakStmt || s instanceof ContinueStmt) return Cost.one();
        if(s instanceof ExpressionStmt e) return expression(e.getExpression(),c);
        if(s instanceof ReturnStmt r) {
            Cost result=r.getExpression().map(e->expression(e,c)).orElse(Cost.one());
            c.returned=c.returned.plus(r.getExpression().map(e->size(e,c)).orElse(Cost.one())); c.sawReturn=true; return result;
        }
        if(s instanceof YieldStmt yielded)return expression(yielded.getExpression(),c);
        if(s instanceof ThrowStmt thrown) return expression(thrown.getExpression(),c);
        if(s instanceof IfStmt f) {
            if(f.getCondition() instanceof BooleanLiteralExpr b) return b.getValue()?statement(f.getThenStmt(),c):f.getElseStmt().map(x->statement(x,c)).orElse(Cost.one());
            Context branch=c.copy(), otherwise=c.copy(); branch.growth.clear(); otherwise.growth.clear(); bindPatterns(f.getCondition(),branch);
            Cost value=expression(f.getCondition(),branch);
            Cost result=value.plus(statement(f.getThenStmt(),branch)).plus(f.getElseStmt().map(x->statement(x,otherwise)).orElse(Cost.one()));
            branch.growth.forEach((name,growth)->c.growth.merge(name,growth,Cost::plus)); otherwise.growth.forEach((name,growth)->c.growth.merge(name,growth,Cost::plus));
            c.immutableGrowth.addAll(branch.immutableGrowth); c.immutableGrowth.addAll(otherwise.immutableGrowth);
            mergeReturns(branch,c); mergeReturns(otherwise,c);
            if(terminates(f.getThenStmt())) guard(f.getCondition(),c);
            invalidateBranchAssignments(f,c); explain(s,result,"Худшая ветка условия; независимые размеры сохраняются в сумме."); return result;
        }
        if(s instanceof ForStmt f) return forLoop(f,c);
        if(s instanceof ForEachStmt f) {
            Cost setup=expression(f.getIterable(),c), iterations=length(f.getIterable(),c);
            if(iterations.unknown) return unknown(s,"Неизвестна стоимость обхода Iterable или размер коллекции.");
            if(iterationMutation(f.getIterable(),f.getBody(),c)) return unknown(s,"Обходимая коллекция может увеличиваться во время обхода.");
            Context body=c.copy(); body.growth.clear(); for(VariableDeclarator v:f.getVariable().getVariables()) {
                body.types.put(v.getNameAsString(),v.getType().isVarType()?Symbols.argument(typeOf(f.getIterable(),c),0):v.getType().asString());
                if(numeric(v.getType().asString())) {
                    body.sizes.put(v.getNameAsString(),Cost.variable("max(|"+f.getIterable()+"[*]|)"));
                    assumptions.add("Стоимость обработки числовых элементов может зависеть от их максимального модуля; для int число десятичных цифр ограничено 10.");
                }
                else body.sizes.put(v.getNameAsString(),Cost.variable("max(|"+f.getIterable()+"[*]|)"));
            }
            Cost result=setup.plus(iterations.times(statement(f.getBody(),body))).plus(propagateGrowth(body,c,iterations)); invalidateBranchAssignments(f.getBody(),c);
            explain(s,result,"Число итераций равно длине массива/стандартной коллекции."); return result;
        }
        if(s instanceof WhileStmt w) return whileLoop(w,c);
        if(s instanceof DoStmt loop) {
            WhileStmt equivalent=new WhileStmt(loop.getCondition().clone(),loop.getBody().clone());
            Cost result=whileLoop(equivalent,c); explain(loop,result,"do-while: первая итерация обязательна; затем та же монотонная граница."); return result;
        }
        if(s instanceof SwitchStmt sw) {
            Cost cost=expression(sw.getSelector(),c);
            // Summing all entries is a safe upper bound even with fall-through.
            for(SwitchEntry entry:sw.getEntries()) { Context branch=c.copy(); bindPatterns(entry,branch); for(Statement child:entry.getStatements()) cost=cost.plus(statement(child,branch)); mergeReturns(branch,c); }
            invalidateBranchAssignments(sw,c); return cost;
        }
        if(s instanceof LabeledStmt label)return statement(label.getStatement(),c);
        if(s instanceof TryStmt attempt) {
            Context body=c.copy(); Cost cost=Cost.one();
            for(Expression resource:attempt.getResources())cost=cost.plus(expression(resource,body));
            cost=cost.plus(statement(attempt.getTryBlock(),body));
            mergeReturns(body,c);
            for(CatchClause caught:attempt.getCatchClauses()) { Context branch=body.copy(); branch.types.put(caught.getParameter().getNameAsString(),caught.getParameter().getType().asString()); cost=cost.plus(statement(caught.getBody(),branch)); mergeReturns(branch,c); }
            if(attempt.getFinallyBlock().isPresent())cost=cost.plus(statement(attempt.getFinallyBlock().get(),body.copy()));
            for(Expression resource:attempt.getResources()) {
                String name=resource instanceof VariableDeclarationExpr declaration?declaration.getVariable(0).getNameAsString():resource.toString();
                cost=cost.plus(methodCall(new MethodCallExpr(new NameExpr(name),"close"),body));
            }
            invalidateBranchAssignments(attempt,c); explain(attempt,cost,"Верхняя граница: try, возможный catch, finally и однократное закрытие каждого ресурса."); return cost;
        }
        if(s instanceof ExplicitConstructorInvocationStmt call) {
            Cost cost=Cost.one(); for(Expression argument:call.getArguments())cost=cost.plus(expression(argument,c)); return cost;
        }
        if(s instanceof SynchronizedStmt) return unknown(s,"Время ожидания монитора зависит от других потоков.");
        return unknown(s,"Неподдерживаемая конструкция: "+s.getClass().getSimpleName());
    }
    void mergeReturns(Context from,Context into) { if(from.sawReturn) { into.returned=into.returned.plus(from.returned); into.sawReturn=true; } }
    boolean iterationMutation(Expression iterable,Statement body,Context c) {
        if(typeOf(iterable,c).endsWith("[]"))return false;
        Expression source=iterable;
        if(iterable instanceof MethodCallExpr call && call.getScope().isPresent()) {
            String receiver=typeOf(call.getScope().get(),c);
            MethodDeclaration target=symbols.method(receiver,call.getNameAsString(),call.getArguments().stream().map(argument->typeOf(argument,c)).toList());
            if(target!=null&&target.getBody().isPresent()) {
                List<ReturnStmt> returns=target.getBody().get().findAll(ReturnStmt.class);
                if(!returns.isEmpty()&&returns.stream().allMatch(returned->returned.getExpression().orElse(null) instanceof ObjectCreationExpr||returned.getExpression().orElse(null) instanceof MethodCallExpr copied&&copied.getNameAsString().equals("copyOf")))return false;
            }
            if(Set.of("values","entrySet","keySet").contains(call.getNameAsString())&&collection(receiver))source=call.getScope().get();
        }
        String name=source.toString(); Set<String> aliases=new HashSet<>(); aliases.add(name);
        boolean changed;
        do {
            changed=false;
            for(VariableDeclarator variable:body.findAll(VariableDeclarator.class))if(variable.getInitializer().map(Object::toString).map(aliases::contains).orElse(false))changed|=aliases.add(variable.getNameAsString());
            for(AssignExpr assignment:body.findAll(AssignExpr.class))if(aliases.contains(assignment.getValue().toString()))changed|=aliases.add(assignment.getTarget().toString());
        } while(changed);
        for(MethodCallExpr call:body.findAll(MethodCallExpr.class)) {
            if(call.getScope().isPresent()&&aliases.contains(call.getScope().get().toString())&&!Set.of("get","getOrDefault","size","isEmpty","contains","containsKey","containsValue","values","entrySet","keySet","remove","clear","set","stream","iterator").contains(call.getNameAsString()))return true;
            if(call.getArguments().stream().anyMatch(argument->aliases.contains(argument.toString())))return true;
            if(source instanceof FieldAccessExpr field&&call.getScope().map(Object::toString).orElse("").equals(field.getScope().toString())) {
                MethodDeclaration target=symbols.method(typeOf(field.getScope(),c),call.getNameAsString(),call.getArguments().stream().map(argument->typeOf(argument,c)).toList());
                if(target==null)return true;
                for(MethodCallExpr nested:target.findAll(MethodCallExpr.class))if(nested.getScope().map(Object::toString).orElse("").equals(field.getNameAsString())&&Set.of("add","addAll","put","putAll","offer").contains(nested.getNameAsString()))return true;
            }
        }
        return false;
    }
    Cost propagateGrowth(Context body,Context parent,Cost count) {
        Cost extra=Cost.one();
        for(var entry:body.growth.entrySet()) {
            Cost total=count.times(entry.getValue());
            parent.sizes.merge(entry.getKey(),total,Cost::plus); parent.growth.merge(entry.getKey(),total,Cost::plus);
            if(body.immutableGrowth.contains(entry.getKey()))extra=extra.plus(count.times(total));
            if(body.linearReads.containsKey(entry.getKey()))extra=extra.plus(count.times(total).times(body.linearReads.get(entry.getKey())));
        }
        body.linearReads.forEach((key,uses)->parent.linearReads.merge(key,count.times(uses),Cost::plus));
        parent.immutableGrowth.addAll(body.immutableGrowth); return extra;
    }
    static boolean terminates(Statement statement) {
        if(statement instanceof ThrowStmt || statement instanceof ReturnStmt)return true;
        if(statement instanceof BlockStmt block)return !block.getStatements().isEmpty()&&terminates(block.getStatement(block.getStatements().size()-1));
        return false;
    }
    void guard(Expression expression,Context c) {
        if(expression instanceof BinaryExpr binary) {
            if(binary.getOperator()==BinaryExpr.Operator.OR) { guard(binary.getLeft(),c); guard(binary.getRight(),c); }
            if(binary.getLeft() instanceof NameExpr variable && integer(binary.getRight())!=null) {
                long value=integer(binary.getRight());
                if(binary.getOperator()==BinaryExpr.Operator.GREATER)c.maximum.put(variable.getNameAsString(),value);
                if(binary.getOperator()==BinaryExpr.Operator.GREATER_EQUALS)c.maximum.put(variable.getNameAsString(),value-1);
            }
            if(binary.getOperator()==BinaryExpr.Operator.LESS_EQUALS&&Long.valueOf(0).equals(integer(binary.getRight()))||binary.getOperator()==BinaryExpr.Operator.LESS&&Long.valueOf(1).equals(integer(binary.getRight())))c.positive.add(binary.getLeft().toString());
        }
    }
    void bindPatterns(Node expression,Context c) {
        for(TypePatternExpr pattern:expression.findAll(TypePatternExpr.class))c.types.put(pattern.getNameAsString(),pattern.getType().asString());
    }
    void invalidateBranchAssignments(Node n, Context c) {
        for(AssignExpr a:n.findAll(AssignExpr.class)) if(a.getTarget() instanceof NameExpr v) { c.sizes.remove(v.getNameAsString()); c.initializers.remove(v.getNameAsString()); }
        for(UnaryExpr u:n.findAll(UnaryExpr.class)) if(u.getOperator().isPostfix() || u.getOperator()==UnaryExpr.Operator.PREFIX_INCREMENT || u.getOperator()==UnaryExpr.Operator.PREFIX_DECREMENT) if(u.getExpression() instanceof NameExpr v) { c.sizes.remove(v.getNameAsString()); c.initializers.remove(v.getNameAsString()); }
    }
    static Set<String> names(Node n) { Set<String> result=new HashSet<>(); n.findAll(NameExpr.class).forEach(x->result.add(x.getNameAsString())); return result; }
    static boolean mutates(Node body, Set<String> variables) {
        for(AssignExpr a:body.findAll(AssignExpr.class)) if(a.getTarget() instanceof NameExpr name && variables.contains(name.getNameAsString())) return true;
        for(UnaryExpr u:body.findAll(UnaryExpr.class)) if((u.getOperator().isPostfix() || u.getOperator()==UnaryExpr.Operator.PREFIX_INCREMENT || u.getOperator()==UnaryExpr.Operator.PREFIX_DECREMENT) && u.getExpression() instanceof NameExpr name && variables.contains(name.getNameAsString())) return true;
        for(MethodCallExpr call:body.findAll(MethodCallExpr.class)) if(call.getScope().isPresent() && !Collections.disjoint(receiverNames(call.getScope().get()),variables) && !Set.of("size","length","get","contains","containsKey","containsValue","isEmpty","charAt","peek","peekFirst","peekLast","values","entrySet","keySet").contains(call.getNameAsString())) return true;
        return false;
    }
    static Set<String> receiverNames(Expression expression) {
        if(expression instanceof MethodCallExpr call)return call.getScope().map(Complexity::receiverNames).orElse(Set.of());
        if(expression instanceof FieldAccessExpr field)return receiverNames(field.getScope());
        if(expression instanceof ArrayAccessExpr array)return receiverNames(array.getName());
        return expression instanceof NameExpr name?Set.of(name.getNameAsString()):Set.of();
    }
    record Update(String variable, boolean increasing, boolean logarithmic, long amount) {}
    static Update update(Expression raw) {
        Expression e=unwrap(raw);
        if(e instanceof UnaryExpr u && u.getExpression() instanceof NameExpr n) {
            return switch(u.getOperator()) {
                case POSTFIX_INCREMENT,PREFIX_INCREMENT -> new Update(n.getNameAsString(),true,false,1);
                case POSTFIX_DECREMENT,PREFIX_DECREMENT -> new Update(n.getNameAsString(),false,false,1);
                default -> null;
            };
        }
        if(e instanceof AssignExpr a && a.getTarget() instanceof NameExpr n) {
            Long amount=integer(a.getValue());
            if(amount==null || amount<=0) return null;
            return switch(a.getOperator()) {
                case PLUS -> new Update(n.getNameAsString(),true,false,amount);
                case MINUS -> new Update(n.getNameAsString(),false,false,amount);
                case DIVIDE -> amount>1 ? new Update(n.getNameAsString(),false,true,amount) : null;
                default -> null;
            };
        }
        return null;
    }
    Cost iterations(Expression condition, Expression start, Update step, Statement body, Context c, boolean updateInside) {
        Expression test=unwrap(condition);
        if(!(test instanceof BinaryExpr b) || !(unwrap(b.getLeft()) instanceof NameExpr n) || !n.getNameAsString().equals(step.variable)) return unknown(condition,"Граница цикла не является поддерживаемым сравнением счётчика.");
        boolean inclusive=b.getOperator()==BinaryExpr.Operator.LESS_EQUALS||b.getOperator()==BinaryExpr.Operator.GREATER_EQUALS;
        boolean ascending=b.getOperator()==BinaryExpr.Operator.LESS||b.getOperator()==BinaryExpr.Operator.LESS_EQUALS;
        boolean descending=b.getOperator()==BinaryExpr.Operator.GREATER||b.getOperator()==BinaryExpr.Operator.GREATER_EQUALS;
        if(!(ascending && step.increasing || descending && !step.increasing)) return unknown(condition,"Направление шага не гарантирует приближение к границе; поддерживаются строгие < и >.");
        if(!Set.of("int","long").contains(c.types.get(step.variable))) return unknown(condition,"Счётчик должен иметь целочисленный тип int или long.");
        if(c.types.get(step.variable).equals("int") && (!b.getRight().findAll(LongLiteralExpr.class).isEmpty() || names(b.getRight()).stream().anyMatch(v -> "long".equals(c.types.get(v))))) return unknown(condition,"Граница long может превышать диапазон счётчика int и привести к переполнению.");
        if(!updateInside && mutates(body,Set.of(step.variable)) && !safeExtraAdvance(body,step.variable,b.getRight())) return unknown(body,"Счётчик дополнительно изменяется в теле цикла.");
        Set<String> boundVariables=names(b.getRight());
        for(ArrayAccessExpr access:b.getRight().findAll(ArrayAccessExpr.class)) {
            String array=access.getName().toString();
            if(body.findAll(AssignExpr.class).stream().anyMatch(write->write.getTarget() instanceof ArrayAccessExpr target&&target.getName().toString().equals(array))||body.findAll(UnaryExpr.class).stream().anyMatch(write->update(write)==null&&write.getExpression() instanceof ArrayAccessExpr target&&target.getName().toString().equals(array)))return unknown(body,"Содержимое массива, задающее границу, изменяется в теле цикла.");
        }
        boolean changesBound=mutates(body,boundVariables);
        if(b.getRight() instanceof MethodCallExpr length&&length.getScope().isPresent()&&length.getNameAsString().equals("size")&&collection(typeOf(length.getScope().get(),c))) {
            boolean rebound=body.findAll(AssignExpr.class).stream().anyMatch(write->write.getTarget() instanceof NameExpr name&&boundVariables.contains(name.getNameAsString()));
            changesBound=rebound||iterationMutation(length.getScope().get(),body,c);
        }
        if(boundVariables.contains(step.variable) || changesBound) return unknown(body,"Граница цикла изменяется или зависит от изменяемого счётчика.");
        for(String variable : boundVariables) if(collection(c.types.getOrDefault(variable,""))) {
            for(MethodCallExpr call : body.findAll(MethodCallExpr.class)) if(call.getArguments().stream().anyMatch(a -> a instanceof NameExpr name && name.getNameAsString().equals(variable))) return unknown(call,"Коллекция из границы цикла передаётся в метод; её размер может измениться.");
        }
        Long lower=integer(b.getRight()), first=integer(start);
        if(inclusive && !(lower!=null && (ascending?lower<Long.MAX_VALUE&&lower<Integer.MAX_VALUE:lower>Long.MIN_VALUE&&lower>Integer.MIN_VALUE)) && !(descending && c.positive.contains(b.getRight().toString())) && !(ascending && b.getRight() instanceof NameExpr variable && c.maximum.getOrDefault(variable.getNameAsString(),Long.MAX_VALUE)<Integer.MAX_VALUE))return unknown(condition,"Включённая граница может вызвать переполнение счётчика.");
        if(step.logarithmic && (lower==null || lower<0)) return unknown(condition,"Делящийся счётчик должен уменьшаться до неотрицательной константы.");
        if(!step.logarithmic && step.amount!=1) return unknown(condition,"Шаг больше единицы требует проверки переполнения Java-счётчика.");
        if(step.logarithmic) { Cost magnitude=size(start,c); return magnitude.unknown?unknown(condition,"Не удалось ограничить начальный модуль счётчика."):magnitude.logarithm(); }
        if(first!=null && lower!=null) return Cost.one();
        // Sizes represent nonnegative magnitudes; a dynamic start and bound both contribute.
        Cost result=descending&&(lower!=null&&lower>=0||c.positive.contains(b.getRight().toString()))?size(start,c):size(start,c).plus(size(b.getRight(),c));
        return result.unknown?unknown(condition,"Не удалось выразить число итераций: "+condition+"; начало "+start+"."):result;
    }
    static boolean safeExtraAdvance(Statement body,String counter,Expression bound) {
        if(body.findAll(AssignExpr.class).stream().anyMatch(write->write.getTarget().toString().equals(counter)))return false;
        List<UnaryExpr> writes=body.findAll(UnaryExpr.class).stream().filter(unary->unary.getExpression().toString().equals(counter)&&update(unary)!=null).toList();
        if(writes.isEmpty())return false;
        for(UnaryExpr write:writes) {
            Update step=update(write); if(!step.increasing||step.amount!=1)return false;
            boolean guarded=false; Node parent=write;
            while(parent!=body&&parent.getParentNode().isPresent()) {
                parent=parent.getParentNode().get();
                if(parent instanceof IfStmt branch && branch.getThenStmt().isAncestorOf(write))guarded|=branch.getCondition().findAll(BinaryExpr.class).stream().anyMatch(test->test.getOperator()==BinaryExpr.Operator.LESS&&test.getRight().toString().equals(bound.toString())&&test.getLeft() instanceof BinaryExpr plus&&plus.getOperator()==BinaryExpr.Operator.PLUS&&plus.getLeft().toString().equals(counter)&&Complexity.integer(plus.getRight())!=null&&Complexity.integer(plus.getRight())>=1);
            }
            if(!guarded)return false;
        }
        return true;
    }
    Cost forLoop(ForStmt f, Context c) {
        if(f.getInitialization().size()!=1 || f.getUpdate().size()!=1 || f.getCompare().isEmpty()) return unknown(f,"for требует одного счётчика, шага и явной границы.");
        Context loop=c.copy(); loop.growth.clear(); Expression init=f.getInitialization().get(0), start; String variable;
        if(init instanceof VariableDeclarationExpr declaration && declaration.getVariables().size()==1 && declaration.getVariable(0).getInitializer().isPresent()) {
            VariableDeclarator v=declaration.getVariable(0); variable=v.getNameAsString(); start=v.getInitializer().get(); loop.types.put(variable,v.getType().asString());
        } else if(init instanceof AssignExpr a && a.getOperator()==AssignExpr.Operator.ASSIGN && a.getTarget() instanceof NameExpr n) { variable=n.getNameAsString(); start=a.getValue(); }
        else return unknown(f,"Неизвестная инициализация счётчика.");
        Update step=update(f.getUpdate().get(0));
        if(step==null || !step.variable.equals(variable)) return unknown(f,"Шаг цикла не распознан; умножающийся счётчик может переполниться.");
        Expression comparison=f.getCompare().get();
        if(comparison instanceof BinaryExpr test&&test.getLeft() instanceof BinaryExpr plus&&plus.getOperator()==BinaryExpr.Operator.PLUS&&plus.getLeft().toString().equals(variable)&&c.positive.contains(plus.getRight().toString())&&test.getRight() instanceof MethodCallExpr length&&length.getNameAsString().equals("size")&&length.getScope().isPresent()&&integer(start)!=null&&integer(start)>=0&&f.getBody() instanceof BlockStmt block&&!block.getStatements().isEmpty()&&block.getStatement(0) instanceof ExpressionStmt first&&first.findAll(MethodCallExpr.class).stream().anyMatch(get->get.getNameAsString().equals("get")&&get.getScope().map(Object::toString).orElse("").equals(length.getScope().get().toString())&&get.getArguments().size()==1&&get.getArgument(0).toString().equals(variable)&&AlgorithmRules.unconditional(get,first))) {
            comparison=new BinaryExpr(new NameExpr(variable),length.clone(),BinaryExpr.Operator.LESS);
            assumptions.add("Для смещённой границы число шагов также ограничено безусловным bounds-checked get(counter); выход за размер завершает цикл исключением.");
        }
        Cost count=iterations(comparison,start,step,f.getBody(),loop,false);
        if(count.unknown) return count;
        Cost setup=expression(start,loop), condition=expression(f.getCompare().get(),loop);
        loop.sizes.put(variable,size(start,c).plus(size(((BinaryExpr)unwrap(comparison)).getRight(),c)));
        Cost amortized=AlgorithmRules.amortized(this,f,loop,count,variable); if(amortized!=null) { invalidateBranchAssignments(f,c); return setup.plus(amortized); }
        if(step.logarithmic) {
            String marker="ι("+variable+")"; loop.sizes.put(variable,Cost.variable(marker));
            Cost body=statement(f.getBody(),loop), result=setup.plus(count.times(condition)).plus(AlgorithmRules.geometric(body,size(start,c),marker));
            invalidateBranchAssignments(f,c); explain(f,result,"Суммирование геометрически уменьшающихся объёмов, без лишнего множителя log n."); return result;
        }
        Cost result=setup.plus(count.times(condition.plus(statement(f.getBody(),loop)))).plus(propagateGrowth(loop,c,count));
        invalidateBranchAssignments(f,c);
        explain(f,result,step.logarithmic?"Счётчик делится на постоянный множитель > 1.":count.format().equals("O(1)")?"Постоянные границы цикла.":"Монотонный счётчик с постоянным шагом; стоимость тела умножается на число итераций.");
        return result;
    }
    Cost whileLoop(WhileStmt w, Context c) {
        Cost specialized=binarySearch(w,c); if(specialized!=null)return specialized;
        specialized=AlgorithmRules.worklist(this,w,c); if(specialized!=null)return specialized;
        specialized=AlgorithmRules.parentChain(this,w,c); if(specialized!=null)return specialized;
        if(w.getCondition() instanceof BinaryExpr test&&test.getOperator()==BinaryExpr.Operator.NOT_EQUALS&&test.getRight().isNullLiteralExpr()&&unwrap(test.getLeft()) instanceof AssignExpr assignment&&assignment.getTarget() instanceof NameExpr line&&assignment.getValue() instanceof MethodCallExpr read&&read.getNameAsString().equals("readLine")&&read.getScope().isPresent()) {
            Cost bytes=c.sizes.get(read.getScope().get().toString());
            if(bytes!=null&&!bytes.unknown) {
                Context body=c.copy(); body.sizes.put(line.getNameAsString(),bytes);
                Cost work=statement(w.getBody(),body).plus(expression(w.getCondition(),body)),result=bytes.times(work);
                explain(w,result,"Конечный StringReader: число строк не больше длины текста + 1; стоимость обработки каждой строки учитывается отдельно.");return result;
            }
        }
        if(w.getCondition() instanceof BinaryExpr condition && condition.getOperator()==BinaryExpr.Operator.NOT_EQUALS && condition.getLeft() instanceof NameExpr variable && Long.valueOf(-1).equals(integer(condition.getRight()))) {
            List<AssignExpr> follows=w.getBody().findAll(AssignExpr.class).stream().filter(write->write.getTarget().toString().equals(variable.getNameAsString())&&write.getValue() instanceof ArrayAccessExpr array&&array.getIndex().toString().equals(variable.getNameAsString())).toList();
            if(follows.size()==1 && c.chains.containsKey(((ArrayAccessExpr)follows.get(0).getValue()).getName().toString())) {
                Cost count=c.chains.get(((ArrayAccessExpr)follows.get(0).getValue()).getName().toString());
                Context body=c.copy(); body.growth.clear(); Cost result=count.times(statement(w.getBody(),body)).plus(propagateGrowth(body,c,count)); explain(w,result,"Цепочка предшественников кратчайшего пути содержит не более V вершин.");return result;
            }
        }
        if(unwrap(w.getCondition()) instanceof BinaryExpr test && test.getOperator()==BinaryExpr.Operator.AND) {
            if(unwrap(test.getLeft()) instanceof BinaryExpr && unwrap(test.getRight()) instanceof BinaryExpr)return twoPointerLoop(w,test,c);
            if(unwrap(test.getLeft()) instanceof BinaryExpr left && left.getLeft() instanceof NameExpr variable && guaranteedIncrement(w.getBody(),variable.getNameAsString())!=null) {
                WhileStmt simple=new WhileStmt(left.clone(),w.getBody().clone()); return whileLoop(simple,c);
            }
        }
        if(!(unwrap(w.getCondition()) instanceof BinaryExpr b) || !(unwrap(b.getLeft()) instanceof NameExpr name)) return unknown(w,"Не распознан счётчик while.");
        List<Statement> body=w.getBody() instanceof BlockStmt block?new ArrayList<>(block.getStatements()):List.of(w.getBody());
        String variable=name.getNameAsString(); Update step=null; int stepAt=-1;
        for(int i=0;i<body.size();i++) if(body.get(i) instanceof ExpressionStmt expression) {
            Update candidate=guaranteedIncrement(expression,variable);
            if(candidate!=null && candidate.variable.equals(variable)) { if(step!=null) return unknown(w,"Несколько шагов счётчика while."); step=candidate; stepAt=i; }
        }
        if(step==null || !w.findAll(ContinueStmt.class).isEmpty()) return unknown(w,"Шаг while может пропускаться или не распознан.");
        for(int i=0;i<body.size();i++) if(i!=stepAt && mutates(body.get(i),Set.of(variable))) return unknown(w,"Счётчик while имеет дополнительные изменения.");
        Expression start=c.initializers.get(variable);
        if(start==null && c.sizes.containsKey(variable)) start=new NameExpr(variable);
        if(start==null) return unknown(w,"Неизвестно начальное значение счётчика while.");
        Cost count=iterations(w.getCondition(),start,step,w.getBody(),c,true);
        Context loop=c.copy(); loop.growth.clear(); Cost magnitude=size(start,c).plus(size(b.getRight(),c)); loop.sizes.put(variable,magnitude);
        Cost bodyCost=Cost.one(); for(Statement child:body) bodyCost=bodyCost.plus(statement(child,loop));
        Cost result=count.times(expression(w.getCondition(),c).plus(bodyCost)).plus(propagateGrowth(loop,c,count));
        invalidateBranchAssignments(w,c); c.sizes.put(variable,magnitude); explain(w,result,"Шаг while выполняется безусловно в каждой полной итерации."); return result;
    }
    static Update guaranteedIncrement(Node statement,String variable) {
        if(statement instanceof ExpressionStmt expression) {
            Update direct=update(expression.getExpression()); if(direct!=null&&direct.variable.equals(variable))return direct;
            if(!expression.findAll(ConditionalExpr.class).isEmpty()||!expression.findAll(LambdaExpr.class).isEmpty()||expression.findAll(BinaryExpr.class).stream().anyMatch(binary->binary.getOperator()==BinaryExpr.Operator.AND||binary.getOperator()==BinaryExpr.Operator.OR))return null;
            List<UnaryExpr> updates=expression.findAll(UnaryExpr.class).stream().filter(unary->{Update step=update(unary);return step!=null&&step.variable.equals(variable);}).toList();
            if(updates.size()==1)return update(updates.get(0));
        }
        return null;
    }
    Cost binarySearch(WhileStmt loop,Context c) {
        if(!(loop.getCondition() instanceof BinaryExpr condition)||condition.getOperator()!=BinaryExpr.Operator.LESS||!(condition.getLeft() instanceof NameExpr left)||!(condition.getRight() instanceof NameExpr right))return null;
        String lo=left.getNameAsString(),hi=right.getNameAsString();
        Expression initial=c.initializers.get(lo);
        if(initial==null||integer(initial)==null||integer(initial)<0||!"int".equals(c.types.get(lo))||!"int".equals(c.types.get(hi)))return null;
        List<VariableDeclarator> middles=loop.getBody().findAll(VariableDeclarator.class).stream().filter(variable->variable.getInitializer().map(Object::toString).orElse("").replace(" ","").equals(lo+"+("+hi+"-"+lo+")/2")).toList();
        if(middles.size()!=1)return null;
        String mid=middles.get(0).getNameAsString();
        if(mutates(loop.getBody(),Set.of(mid))||loop.getBody().findAll(UnaryExpr.class).stream().anyMatch(unary->update(unary)!=null&&Set.of(lo,hi).contains(update(unary).variable)))return unknown(loop,"Дополнительная запись нарушает инвариант бинарного поиска.");
        List<AssignExpr> writes=loop.getBody().findAll(AssignExpr.class).stream().filter(assignment->assignment.getTarget().toString().equals(lo)||assignment.getTarget().toString().equals(hi)).toList();
        if(writes.size()!=2)return unknown(loop,"Не каждая ветка бинарного поиска уменьшает интервал.");
        Set<String> found=new HashSet<>();
        for(AssignExpr assignment:writes) {
            String expected=assignment.getTarget().toString().equals(lo)?mid+"+1":mid;
            if(assignment.getOperator()!=AssignExpr.Operator.ASSIGN||!assignment.getValue().toString().replace(" ","").equals(expected))return unknown(loop,"Небезопасное обновление границы бинарного поиска.");
            found.add(assignment.getTarget().toString());
        }
        List<IfStmt> branches=loop.getBody().findAll(IfStmt.class).stream().filter(branch->branch.getElseStmt().isPresent()&&writes.stream().anyMatch(write->branch.getThenStmt().isAncestorOf(write)||branch.getThenStmt()==write.getParentNode().orElse(null))&&writes.stream().anyMatch(write->branch.getElseStmt().get().isAncestorOf(write)||branch.getElseStmt().get()==write.getParentNode().orElse(null))).toList();
        if(found.size()!=2||branches.size()!=1||!loop.findAll(ContinueStmt.class).isEmpty())return unknown(loop,"Продвижение бинарного поиска не гарантируется по всем веткам.");
        Context body=c.copy(); body.sizes.put(mid,size(condition.getRight(),c).plus(size(condition.getLeft(),c)));
        Cost work=statement(loop.getBody(),body), count=size(condition.getRight(),c).plus(size(condition.getLeft(),c)).logarithm();
        Cost result=count.times(work); explain(loop,result,"Бинарный поиск: обе ветки уменьшают полуоткрытый интервал как минимум вдвое."); return result;
    }
    static boolean advances(Statement statement, Set<String> counters) {
        if(statement instanceof ExpressionStmt expression) { for(String counter:counters) { Update step=guaranteedIncrement(expression,counter); if(step!=null&&step.increasing&&!step.logarithmic&&step.amount==1)return true; } return false; }
        if(statement instanceof BlockStmt block) return block.getStatements().stream().anyMatch(s->advances(s,counters));
        if(statement instanceof IfStmt branch) return advances(branch.getThenStmt(),counters) && branch.getElseStmt().map(s->advances(s,counters)).orElse(false);
        return false;
    }
    static int maxIncrements(Statement statement, String counter) {
        if(statement instanceof BlockStmt block) return block.getStatements().stream().mapToInt(s->maxIncrements(s,counter)).sum();
        if(statement instanceof IfStmt branch) {
            if(mutates(branch.getCondition(),Set.of(counter))) return 2;
            return Math.max(maxIncrements(branch.getThenStmt(),counter),branch.getElseStmt().map(s->maxIncrements(s,counter)).orElse(0));
        }
        if(statement instanceof ExpressionStmt expression) {
            List<UnaryExpr> writes=expression.findAll(UnaryExpr.class).stream().filter(unary->update(unary)!=null&&update(unary).variable.equals(counter)).toList();
            if(!writes.isEmpty())return writes.size();
            Update step=update(expression.getExpression()); if(step!=null && step.variable.equals(counter)) return 1;
        }
        return mutates(statement,Set.of(counter))?2:0;
    }
    Cost twoPointerLoop(WhileStmt loop, BinaryExpr condition, Context c) {
        if(!(unwrap(condition.getLeft()) instanceof BinaryExpr left) || !(unwrap(condition.getRight()) instanceof BinaryExpr right)) return unknown(loop,"Составная граница while не распознана.");
        List<BinaryExpr> guards=List.of(left,right); Set<String> counters=new HashSet<>(); Cost count=Cost.one(); Context body=c.copy();
        for(BinaryExpr guard:guards) {
            if(guard.getOperator()!=BinaryExpr.Operator.LESS || !(unwrap(guard.getLeft()) instanceof NameExpr variable)) return unknown(loop,"Два указателя требуют строгих верхних границ.");
            String name=variable.getNameAsString(); Expression start=c.initializers.get(name);
            if(!counters.add(name) || !"int".equals(c.types.get(name)) || start==null) return unknown(loop,"Неизвестны начальные значения двух независимых указателей.");
            if(!typeOf(guard.getRight(),c).equals("int"))return unknown(loop,"Граница указателя должна помещаться в int.");
            Set<String> arrays=names(guard.getRight());
            if(mutates(loop.getBody(),arrays) || loop.getBody().findAll(MethodCallExpr.class).stream().anyMatch(call->call.getArguments().stream().anyMatch(arg->!Collections.disjoint(names(arg),arrays)))) return unknown(loop,"Массив из границы указателя может изменяться.");
            Cost bound=size(guard.getRight(),c).plus(size(start,c)); count=count.plus(bound); body.sizes.put(name,bound);
        }
        if(!loop.getBody().findAll(ContinueStmt.class).isEmpty() || !loop.getBody().findAll(BreakStmt.class).isEmpty() || !loop.getBody().findAll(ReturnStmt.class).isEmpty() || !advances(loop.getBody(),counters)) return unknown(loop,"Не каждая ветка гарантирует продвижение хотя бы одного указателя.");
        for(String counter:counters) if(maxIncrements(loop.getBody(),counter)>1) return unknown(loop,"Указатель может сделать несколько шагов за итерацию и переполниться.");
        for(AssignExpr assignment:loop.getBody().findAll(AssignExpr.class)) if(!Collections.disjoint(names(assignment.getTarget()),counters)) return unknown(loop,"Присваивание может сбросить указатель.");
        for(UnaryExpr unary:loop.getBody().findAll(UnaryExpr.class)) if(!Collections.disjoint(names(unary.getExpression()),counters) && (unary.getOperator().isPostfix() || unary.getOperator()==UnaryExpr.Operator.PREFIX_INCREMENT || unary.getOperator()==UnaryExpr.Operator.PREFIX_DECREMENT)) {
            Update step=update(unary); if(step==null || !step.increasing) return unknown(loop,"Указатель может двигаться назад.");
        }
        Cost result=count.times(expression(condition,c).plus(statement(loop.getBody(),body)));
        invalidateBranchAssignments(loop,c);
        for(String counter:counters)c.sizes.put(counter,count);
        explain(loop,result,"Каждая ветка продвигает хотя бы один из двух указателей; число шагов ограничено суммой длин массивов."); return result;
    }
    Cost expression(Expression raw, Context c) {
        Expression e=unwrap(raw);
        if(e instanceof LiteralExpr || e instanceof NameExpr || e instanceof ThisExpr || e instanceof ClassExpr || e instanceof TypeExpr || e instanceof MethodReferenceExpr || e instanceof LambdaExpr) return Cost.one();
        if(e instanceof VariableDeclarationExpr declaration) {
            Cost cost=Cost.one();
            for(VariableDeclarator v:declaration.getVariables()) {
                String name=v.getNameAsString(); c.types.put(name,v.getType().asString());
                if(v.getInitializer().isPresent()) {
                    Expression init=v.getInitializer().get(); cost=cost.plus(expression(init,c));
                    if(v.getType().isVarType())c.types.put(name,typeOf(init,c));
                    Cost value=size(init,c); if(!value.unknown)c.sizes.put(name,value); else c.sizes.remove(name); c.initializers.put(name,init);
                    if(init instanceof ObjectCreationExpr created)c.concrete.put(name,created.getType().asString());
                    if(integer(init)!=null)c.maximum.put(name,integer(init));
                }
            }
            return cost;
        }
        if(e instanceof BinaryExpr b) {
            if(b.getOperator()==BinaryExpr.Operator.PLUS && (typeOf(b.getLeft(),c).equals("String") || typeOf(b.getRight(),c).equals("String"))) return expression(b.getLeft(),c).plus(expression(b.getRight(),c)).plus(textConversion(b.getLeft(),c)).plus(textConversion(b.getRight(),c));
            return expression(b.getLeft(),c).plus(expression(b.getRight(),c));
        }
        if(e instanceof UnaryExpr u) return expression(u.getExpression(),c);
        if(e instanceof AssignExpr a) {
            Cost cost=expression(a.getTarget(),c).plus(expression(a.getValue(),c));
            if(typeOf(a.getTarget(),c).equals("String")&&(a.getOperator()==AssignExpr.Operator.PLUS || a.getValue() instanceof BinaryExpr binary&&binary.getOperator()==BinaryExpr.Operator.PLUS&&names(binary).contains(a.getTarget().toString()))) {
                Cost added=textLength(a.getValue(),c); cost=cost.plus(textLength(a.getTarget(),c)).plus(added);
                c.growth.merge(a.getTarget().toString(),added,Cost::plus); c.immutableGrowth.add(a.getTarget().toString());
            }
            if(a.getTarget() instanceof NameExpr n) {
                Cost value=size(a.getValue(),c);
                if(a.getOperator()==AssignExpr.Operator.ASSIGN && !value.unknown)c.sizes.put(n.getNameAsString(),value); else c.sizes.remove(n.getNameAsString());
                if(a.getOperator()==AssignExpr.Operator.ASSIGN)c.initializers.put(n.getNameAsString(),a.getValue()); else c.initializers.remove(n.getNameAsString());
            }
            return cost;
        }
        if(e instanceof ArrayAccessExpr a) return expression(a.getName(),c).plus(expression(a.getIndex(),c));
        if(e instanceof ArrayCreationExpr a) {
            Cost volume=Cost.one(), dimensions=Cost.one();
            for(var level:a.getLevels()) if(level.getDimension().isPresent()) { volume=volume.times(size(level.getDimension().get(),c)); dimensions=dimensions.plus(expression(level.getDimension().get(),c)); }
            if(a.getInitializer().isPresent()) volume=volume.plus(expression(a.getInitializer().get(),c));
            return volume.plus(dimensions);
        }
        if(e instanceof ArrayInitializerExpr a) { Cost cost=Cost.one(); for(Expression value:a.getValues())cost=cost.plus(expression(value,c));return cost; }
        if(e instanceof FieldAccessExpr f) return expression(f.getScope(),c);
        if(e instanceof CastExpr cast) return expression(cast.getExpression(),c);
        if(e instanceof ConditionalExpr cond) return expression(cond.getCondition(),c).plus(expression(cond.getThenExpr(),c.copy())).plus(expression(cond.getElseExpr(),c.copy()));
        if(e instanceof MethodCallExpr call) return methodCall(call,c);
        if(e instanceof ObjectCreationExpr created)return creation(created,c);
        if(e instanceof SwitchExpr select) {
            Cost cost=expression(select.getSelector(),c);
            for(SwitchEntry entry:select.getEntries()) { Context branch=c.copy(); bindPatterns(entry,branch); for(Statement child:entry.getStatements())cost=cost.plus(statement(child,branch)); }
            return cost;
        }
        if(e instanceof InstanceOfExpr instance) return expression(instance.getExpression(),c);
        return unknown(e,"Неизвестная стоимость выражения: "+e.getClass().getSimpleName());
    }
    Cost textLength(Expression expression,Context c) {
        String type=baseType(typeOf(expression,c));
        if(numeric(type) || expression instanceof LiteralExpr || type.equals("Class") || symbols.type(type) instanceof EnumDeclaration)return Cost.one();
        if(type.equals("String")||type.equals("StringBuilder"))return length(expression,c);
        return Cost.variable("|text("+expression+")|");
    }
    Cost textConversion(Expression value,Context c) {
        String type=baseType(typeOf(value,c));
        if(numeric(type)||value instanceof LiteralExpr||Set.of("String","StringBuilder","Class").contains(type)||symbols.type(type) instanceof EnumDeclaration)return textLength(value,c);
        MethodDeclaration conversion=symbols.method(type,"toString",List.of());
        if(conversion!=null)return methodCall(new MethodCallExpr(value.clone(),"toString"),c).plus(textLength(value,c));
        assumptions.add("Неизвестная реализация toString задаётся стоимостью C(toString), отдельно от длины полученной строки.");
        return Cost.variable("C(toString("+value+"))").plus(textLength(value,c));
    }
    Cost linearSize(Expression receiver,Context c) {
        String key=receiver instanceof FieldAccessExpr field&&field.getScope() instanceof ThisExpr?field.getNameAsString():receiver.toString();
        c.linearReads.merge(key,Cost.one(),Cost::plus);
        return length(receiver,c);
    }
    Context lambdaContext(LambdaExpr lambda,String receiver,Context c) {
        Context body=c.copy();
        for(Parameter parameter:lambda.getParameters()) {
            String type=parameter.getType().isUnknownType()?Symbols.argument(receiver,0):parameter.getType().asString();
            body.types.put(parameter.getNameAsString(),type);
            body.sizes.put(parameter.getNameAsString(),Cost.variable("max(|element("+receiver+")|)"));
        }
        return body;
    }
    Cost callback(Expression expression,String receiver,Context c) {
        if(expression instanceof LambdaExpr lambda)return statement(lambda.getBody(),lambdaContext(lambda,receiver,c));
        if(expression instanceof MethodReferenceExpr reference) {
            String scope=reference.getScope().toString(), name=reference.getIdentifier();
            TypeDeclaration<?> owner=symbols.type(scope);
            if(owner instanceof RecordDeclaration && !symbols.field(scope,name).isEmpty())return Cost.one();
            if(Set.of("Integer","Long","Double","String","Math").contains(scope) && Set.of("sum","min","max","intValue","longValue","length","compare","valueOf").contains(name))return Cost.one();
            String type=c.types.getOrDefault(reference.getScope().toString(),typeOf(reference.getScope(),c));
            if(collection(type)) {
                MethodCallExpr call=new MethodCallExpr(c.types.containsKey(scope)?new NameExpr(scope):reference.getScope().clone(),name);
                call.addArgument(new IntegerLiteralExpr("0")); return methodCall(call,c);
            }
            return Cost.variable("C("+reference+")");
        }
        if(expression instanceof MethodCallExpr&&baseType(typeOf(expression,c)).equals("Comparator")) {
            Cost cost=Cost.one();
            for(LambdaExpr lambda:expression.findAll(LambdaExpr.class))cost=cost.plus(statement(lambda.getBody(),lambdaContext(lambda,receiver,c)));
            for(MethodReferenceExpr reference:expression.findAll(MethodReferenceExpr.class))cost=cost.plus(callback(reference,receiver,c));
            return cost;
        }
        assumptions.add("Стоимость функционального параметра C(f) задаётся отдельно; callback не считается автоматически O(1).");
        return Cost.variable("C("+expression+")");
    }
    Context callee(MethodDeclaration method,MethodCallExpr call,Context caller,String receiver) {
        Context c=context(Symbols.owner(method),call.getScope().map(scope->scope+".").orElse(caller.receiver),receiver);
        for(String field:new ArrayList<>(c.types.keySet())) {
            String key=call.getScope().map(scope->scope instanceof ThisExpr?field:scope+"."+field).orElse(field);
            if(caller.sizes.containsKey(key))c.sizes.put(field,caller.sizes.get(key));
        }
        for(int i=0;i<method.getParameters().size();i++) {
            Parameter parameter=method.getParameter(i); Expression argument=call.getArgument(i);
            String declared=symbols.bind(parameter.getType().asString(),Symbols.owner(method),receiver);
            c.types.put(parameter.getNameAsString(),declared);
            Cost magnitude=collection(typeOf(argument,caller))||typeOf(argument,caller).endsWith("[]")?length(argument,caller):size(argument,caller);
            if(!magnitude.unknown)c.sizes.put(parameter.getNameAsString(),magnitude);
            if(argument instanceof NameExpr name && caller.maximum.containsKey(name.getNameAsString()))c.maximum.put(parameter.getNameAsString(),caller.maximum.get(name.getNameAsString()));
            if(integer(argument)!=null)c.maximum.put(parameter.getNameAsString(),integer(argument));
            if(argument instanceof NameExpr name && caller.concrete.containsKey(name.getNameAsString()))c.concrete.put(parameter.getNameAsString(),caller.concrete.get(name.getNameAsString()));
            if(argument instanceof NameExpr name && caller.initializers.get(name.getNameAsString()) instanceof ObjectCreationExpr created)c.initializers.put(parameter.getNameAsString(),created);
        }
        return c;
    }
    record Summary(Cost time,Cost returned,Context body) {}
    final Map<String,Summary> summaries=new HashMap<>();
    final Set<Node> sizing=Collections.newSetFromMap(new IdentityHashMap<>());
    Summary summarize(MethodDeclaration method,MethodCallExpr call,Context caller,String receiver) {
        Context body=callee(method,call,caller,receiver);
        String key=method.getData(Engine.ID)+":"+receiver+":"+body.receiver+":"+new TreeMap<>(body.sizes)+":"+new TreeMap<>(body.maximum)+":"+new TreeMap<>(body.concrete)+":"+new TreeMap<>(body.initializers);
        if(summaries.containsKey(key))return summaries.get(key);
        if(stack.contains(method)||sizing.contains(method))return new Summary(Cost.unknownCost(),Cost.unknownCost(),body);
        if(++calls>128)return new Summary(unknown(call,"Превышен бюджет межпроцедурного анализа."),Cost.unknownCost(),body);
        stack.add(method); sizing.add(method);
        Cost time=callable(method,body); stack.remove(method); sizing.remove(method);
        Summary summary=new Summary(time,body.sawReturn?body.returned:Cost.unknownCost(),body); summaries.put(key,summary); return summary;
    }
    Cost returnSize(MethodCallExpr call,Context c) {
        String name=call.getNameAsString(), scope=call.getScope().map(Object::toString).orElse("");
        String receiver=call.getScope().map(e->typeOf(e,c)).orElse(c.owner==null?"":c.owner.getNameAsString());
        if(symbols.type(receiver) instanceof RecordDeclaration && call.getArguments().isEmpty() && !symbols.field(receiver,name).isEmpty()) {
            return Cost.variable(numeric(typeOf(call,c))?call.toString():"|"+call+"|");
        }
        if(Set.of("Math","StrictMath").contains(scope)&&Set.of("min","max","abs").contains(name)) {
            Cost result=Cost.one(); for(Expression argument:call.getArguments())result=result.plus(size(argument,c)); return result;
        }
        MethodDeclaration target=symbols.method(receiver,name,call.getArguments().stream().map(arg->typeOf(arg,c)).toList());
        if(target!=null) {
            Cost result=Cost.one();
            for(MethodDeclaration variant:symbols.dispatch(receiver,target))result=result.plus(summarize(variant,call,c,variant==target?receiver:Symbols.owner(variant).getNameAsString()).returned);
            if(result.unknown) {
                assumptions.add("Размер результата "+name+" задаётся отдельным символом: он не выводится из стоимости вычисления.");
                return Cost.variable(numeric(typeOf(call,c))?"|result("+call+")|":"|"+call+"|");
            }
            return result;
        }
        if(collection(typeOf(call,c))||typeOf(call,c).endsWith("[]")||baseType(typeOf(call,c)).equals("String"))return length(call,c);
        if(Set.of("nextInt","nextLong","ordinal","parseInt","parseLong").contains(name))return Cost.variable(call.toString());
        return Cost.unknownCost();
    }
    Cost creation(ObjectCreationExpr created,Context c) {
        Cost cost=Cost.one(); for(Expression argument:created.getArguments())cost=cost.plus(expression(argument,c));
        String type=created.getType().asString(), raw=baseType(type); TypeDeclaration<?> owner=symbols.type(type);
        if(owner!=null) {
            Context body=context(owner,""); List<? extends Node> constructors=owner.getMembers().stream().filter(member->member instanceof ConstructorDeclaration constructor&&constructor.getParameters().size()==created.getArguments().size()||member instanceof CompactConstructorDeclaration&&owner instanceof RecordDeclaration record&&record.getParameters().size()==created.getArguments().size()).toList();
            if(constructors.size()>1)return unknown(created,"Конструктор неоднозначен: "+type);
            if(constructors.isEmpty())return cost;
            Node constructor=constructors.get(0); if(stack.contains(constructor))return unknown(created,"Рекурсивное создание объектов.");
            List<Parameter> parameters=Symbols.parameters(constructor);
            for(int i=0;i<parameters.size();i++) {
                Parameter parameter=parameters.get(i); Expression argument=created.getArgument(i); body.types.put(parameter.getNameAsString(),parameter.getType().asString());
                Cost magnitude=collection(typeOf(argument,c))||typeOf(argument,c).endsWith("[]")?length(argument,c):size(argument,c);
                if(!magnitude.unknown)body.sizes.put(parameter.getNameAsString(),magnitude);
            }
            stack.add(constructor);
            cost=cost.plus(callable(constructor,body)); stack.remove(constructor); return cost;
        }
        if(collection(type)&&!created.getArguments().isEmpty()) {
            Expression first=created.getArgument(0); if(collection(typeOf(first,c))||typeOf(first,c).endsWith("[]"))return cost.plus(length(first,c));
            if(numeric(typeOf(first,c))&&!raw.equals("PriorityQueue"))return cost.plus(size(first,c));
        }
        if(raw.equals("StringBuilder")||raw.equals("String")) for(Expression argument:created.getArguments())cost=cost.plus(numeric(typeOf(argument,c))?size(argument,c):textLength(argument,c));
        if(raw.endsWith("Exception")||raw.endsWith("Error"))assumptions.add("Фиксированные накладные расходы JVM и построения stack trace не масштабируются с размером данных; анализируется алгоритмическая модель.");
        if(collection(type)||Set.of("String","StringBuilder","SplittableRandom","Random","BufferedReader","StringReader","InputStreamReader").contains(raw)||raw.endsWith("Exception")||raw.endsWith("Error"))return cost;
        return unknown(created,"Нет контракта конструктора "+type+".");
    }
    Cost methodCall(MethodCallExpr call, Context c) {
        Cost arguments=Cost.one(); for(Expression argument:call.getArguments())arguments=arguments.plus(expression(argument,c));
        String name=call.getNameAsString(), scope=call.getScope().map(Object::toString).orElse("");
        Expression receiverExpression=call.getScope().orElse(null);
        if(receiverExpression!=null)arguments=arguments.plus(expression(receiverExpression,c));
        String receiver=receiverExpression==null?(c.owner==null?"":c.owner.getNameAsString()):typeOf(receiverExpression,c);
        String raw=baseType(receiver);
        TypeDeclaration<?> owner=symbols.type(receiver);
        if(owner instanceof RecordDeclaration && call.getArguments().isEmpty()&&!symbols.field(receiver,name).isEmpty())return arguments;
        MethodDeclaration target=symbols.method(receiver,name,call.getArguments().stream().map(argument->typeOf(argument,c)).toList());
        if(target!=null) {
            if(target.getBody().isEmpty()) {
                Cost closed=sealedAccessor(target); if(closed!=null)return arguments.plus(closed);
                assumptions.add("Динамически выбираемая реализация "+name+" имеет отдельную стоимость C; её тело не подменяется константой.");
                return arguments.plus(Cost.variable("C("+call+")"));
            }
            if(stack.contains(target))return recursiveUnit.contains(target)?arguments:unknown(call,"Рекурсия требует распознанного рекуррентного соотношения.");
            Summary summary=summarize(target,call,c,receiver); Context body=summary.body;
            Cost result=arguments.plus(summary.time);
            List<MethodDeclaration> variants=symbols.dispatch(receiver,target);
            if(variants.size()>1) {
                assumptions.add("Виртуальная диспетчеризация учитывает реализации загруженного проекта; внешние динамически загружаемые подклассы требуют отдельного контракта.");
                for(MethodDeclaration variant:variants)if(variant!=target)result=result.plus(summarize(variant,call,c,Symbols.owner(variant).getNameAsString()).time);
            }
            for(MethodDeclaration variant:variants) {
                Context effects=variant==target?body:summarize(variant,call,c,Symbols.owner(variant).getNameAsString()).body;
                for(var effect:effects.growth.entrySet()) {
                    String key=null;
                    for(int i=0;i<variant.getParameters().size();i++)if(variant.getParameter(i).getNameAsString().equals(effect.getKey()))key=call.getArgument(i).toString();
                    if(key==null&&!symbols.field(Symbols.owner(variant).getNameAsString(),effect.getKey()).isEmpty())key=call.getScope().map(scopeExpr->scopeExpr instanceof ThisExpr?effect.getKey():scopeExpr+"."+effect.getKey()).orElse(effect.getKey());
                    if(key!=null) { c.sizes.merge(key,effect.getValue(),Cost::plus); c.growth.merge(key,effect.getValue(),Cost::plus); if(effects.immutableGrowth.contains(effect.getKey()))c.immutableGrowth.add(key); }
                }
            }
            explain(call,result,"Стоимость метода "+Symbols.owner(target).getNameAsString()+"."+name+" с подстановкой аргументов."); return result;
        }
        if(owner instanceof EnumDeclaration && Set.of("values","name","ordinal","toString","valueOf").contains(name))return arguments.plus(name.equals("valueOf")&&!call.getArguments().isEmpty()?textLength(call.getArgument(0),c):Cost.one());
        if(Set.of("Math","java.lang.Math","StrictMath","java.lang.StrictMath").contains(scope)&&Set.of("abs","min","max","floor","ceil","round","sqrt","signum").contains(name))return arguments;
        if(Set.of("Integer","Long","Double","Boolean","Character").contains(scope)&&Set.of("sum","min","max","compare","toUnsignedLong","toUnsignedString","valueOf","parseInt","parseLong","toString").contains(name))return arguments.plus(call.getArguments().isEmpty()?Cost.one():textLength(call.getArgument(0),c));
        if(scope.equals("Objects")&&name.equals("requireNonNull"))return arguments.plus(call.getArguments().size()>1&&!(call.getArgument(1) instanceof StringLiteralExpr)?callback(call.getArgument(1),"List<Object>",c):Cost.one());
        if(scope.equals("Objects")&&Set.of("equals","hash").contains(name))return arguments.plus(Cost.variable("C("+name+" elements)"));
        if(scope.equals("Comparator")||raw.equals("Comparator"))return arguments;
        if(scope.equals("Collectors")||scope.equals("java.util.stream.Collectors"))return arguments;
        if(Set.of("List","Set","Map","Optional").contains(scope)&&Set.of("of","ofNullable","empty","copyOf").contains(name))return arguments.plus(name.equals("copyOf")?length(call.getArgument(0),c):Cost.one());
        if(Set.of("Arrays","java.util.Arrays","Collections","java.util.Collections").contains(scope)) {
            if(Set.of("fill","copyOf","copyOfRange","toString","equals").contains(name)&&!call.getArguments().isEmpty()) {
                String element=typeOf(call.getArgument(0),c).replaceFirst("\\[\\]$","");
                Cost each=Set.of("toString","equals").contains(name)&&!numeric(element)?Cost.variable("C("+name+" element)"):Cost.one();
                return arguments.plus(length(call.getArgument(0),c).times(each));
            }
            if(name.equals("sort")&&!call.getArguments().isEmpty()) {
                Cost n=length(call.getArgument(0),c), comparator=call.getArguments().size()>1?callback(call.getArgument(call.getArguments().size()-1),"List<Object>",c):Cost.one();
                return arguments.plus(n.times(n.logarithm()).times(comparator));
            }
            if(name.equals("emptyList")||name.equals("emptyMap")||name.equals("emptySet"))return arguments;
        }
        if(scope.equals("System")&&name.equals("arraycopy"))return arguments.plus(size(call.getArgument(4),c));
        if(scope.equals("String")&&name.equals("join")&&call.getArguments().size()>1) {
            Cost n=length(call.getArgument(1),c),element=Cost.variable("max(|text(element)|)"); return arguments.plus(n.times(element));
        }
        if(scope.startsWith("System.out")||scope.startsWith("System.err")) {
            Cost cost=arguments; for(Expression argument:call.getArguments())cost=cost.plus(textConversion(argument,c));
            assumptions.add("Для вывода считается объём данных; ожидание ОС/пользовательского ввода не ограничивается этой оценкой.");return cost;
        }
        if(raw.equals("String")) {
            Cost n=length(receiverExpression,c);
            if(Set.of("length","charAt","isEmpty").contains(name))return arguments;
            if(Set.of("isBlank","strip","trim","toLowerCase","toUpperCase","substring","equals","compareTo").contains(name))return arguments.plus(n);
            if(Set.of("startsWith","endsWith").contains(name))return arguments.plus(call.getArguments().isEmpty()?Cost.one():textLength(call.getArgument(0),c));
            if(name.equals("split")) {
                if(!call.getArguments().isEmpty()&&call.getArgument(0) instanceof StringLiteralExpr pattern&&Set.of("\\s+",","," ").contains(pattern.asString()))return arguments.plus(n);
                return unknown(call,"Произвольное регулярное выражение может иметь нелинейное или экспоненциальное время.");
            }
            if(Set.of("contains","indexOf").contains(name))return arguments.plus(n.times(call.getArguments().isEmpty()?Cost.one():textLength(call.getArgument(0),c)));
            if(name.equals("toString"))return arguments;
        }
        if(raw.equals("StringBuilder")) {
            if(Set.of("length","charAt").contains(name))return arguments;
            if(name.equals("setLength"))return arguments.plus(call.getArguments().isEmpty()?Cost.one():size(call.getArgument(0),c));
            if(name.equals("append")||name.equals("appendCodePoint")) {
                Cost added=call.getArguments().isEmpty()?Cost.one():textLength(call.getArgument(0),c);
                String key=receiverExpression.toString(); c.growth.merge(key,added,Cost::plus); c.sizes.merge(key,added,Cost::plus); return arguments.plus(added).plus(call.getArguments().isEmpty()?Cost.one():textConversion(call.getArgument(0),c));
            }
            if(Set.of("toString","reverse","delete","deleteCharAt").contains(name))return arguments.plus(linearSize(receiverExpression,c));
        }
        if(Set.of("Optional","OptionalInt","OptionalLong","OptionalDouble").contains(raw)) {
            if(Set.of("isPresent","isEmpty","get","orElse").contains(name))return arguments;
            if(Set.of("map","flatMap","filter","orElseThrow","orElseGet").contains(name))return arguments.plus(call.getArguments().isEmpty()?Cost.one():callback(call.getArgument(0),"List<"+Symbols.argument(receiver,0)+">",c));
        }
        if(raw.equals("Stream")||raw.equals("IntStream")||raw.equals("LongStream")) {
            Cost n=length(receiverExpression,c), upstream=receiverExpression instanceof MethodCallExpr chain?methodCall(chain,c):Cost.one();
            if(Set.of("filter","map","mapToInt","mapToLong","peek").contains(name))return upstream.plus(arguments).plus(n.times(callback(call.getArgument(0),receiver,c)));
            if(name.equals("sorted"))return upstream.plus(n.times(n.logarithm()).times(call.getArguments().isEmpty()?Cost.one():callback(call.getArgument(0),receiver,c)));
            if(Set.of("findFirst","findAny","toList","toArray","sum","count","max","min","average").contains(name))return upstream.plus(arguments).plus(n.times(call.getArguments().isEmpty()?Cost.one():callback(call.getArgument(0),receiver,c)));
            if(Set.of("anyMatch","allMatch","noneMatch","forEach","collect","reduce").contains(name)) {
                Cost callback=Cost.one(); for(Expression argument:call.getArguments())callback=callback.plus(argument instanceof LambdaExpr||argument instanceof MethodReferenceExpr?callback(argument,receiver,c):Cost.one());
                if(name.equals("collect")&&baseType(typeOf(call,c)).equals("String"))callback=callback.plus(Cost.variable("max(|stream text element|)"));
                else if(name.equals("collect")) {
                    boolean standard=call.getArguments().size()==1&&call.getArgument(0) instanceof MethodCallExpr collector&&collector.getScope().map(Object::toString).orElse("").endsWith("Collectors")&&(Set.of("toList","toUnmodifiableList").contains(collector.getNameAsString())||collector.getNameAsString().equals("toCollection")&&collector.getArguments().size()==1&&collector.getArgument(0) instanceof MethodReferenceExpr factory&&factory.getIdentifier().equals("new")&&Set.of("ArrayList","LinkedList","ArrayDeque").contains(factory.getScope().toString()));
                    if(!standard)callback=callback.plus(Cost.variable("C(collector accumulator/combiner)"));
                }
                if(name.equals("reduce"))callback=callback.plus(Cost.variable("C(reducer at maximum accumulator size)"));
                return upstream.plus(arguments).plus(n.times(callback));
            }
        }
        if(collection(receiver)) {
            Cost n=length(receiverExpression,c), operation=null;
            if(name.equals("forEach")&&!call.getArguments().isEmpty())return arguments.plus(n.times(callback(call.getArgument(0),receiver,c)));
            String concrete=receiverExpression instanceof NameExpr variable?baseType(c.concrete.getOrDefault(variable.getNameAsString(),receiver)):raw;
            if(Set.of("size","isEmpty","values","keySet","entrySet","stream","iterator","peek","peekFirst","peekLast","getFirst","getLast","getKey","getValue").contains(name))operation=Cost.one();
            if(Set.of("get","getOrDefault","set").contains(name))operation=concrete.equals("ArrayList")?Cost.one():concrete.equals("TreeMap")?n.logarithm():n;
            if(Set.of("contains","containsKey","containsValue","put","putIfAbsent","merge","compute","computeIfAbsent","add","offer","poll","remove","removeFirst","removeLast","addFirst","addLast","clear","forEach").contains(name)) {
                if(concrete.equals("EnumMap"))operation=Cost.one();
                else if(concrete.equals("TreeMap")||concrete.equals("TreeSet")||concrete.equals("PriorityQueue"))operation=n.logarithm();
                else if(concrete.equals("ArrayDeque")||concrete.equals("Deque")||concrete.equals("ArrayList")&&Set.of("add").contains(name))operation=Cost.one();
                else operation=n;
                if(name.equals("clear"))operation=n;
                if(name.equals("contains")&&(concrete.equals("TreeMap")||concrete.equals("PriorityQueue")))operation=n;
                if(concrete.equals("PriorityQueue")&&name.equals("remove")&&!call.getArguments().isEmpty())operation=n;
                if(Set.of("ArrayDeque","Deque").contains(concrete)&&(name.equals("contains")||name.equals("remove")&&!call.getArguments().isEmpty()))operation=n;
                if(concrete.equals("ArrayList")&&name.equals("add")&&call.getArguments().size()>1)operation=n;
                if(concrete.equals("PriorityQueue")&&Set.of("add","offer","poll","remove").contains(name)&&!(name.equals("remove")&&!call.getArguments().isEmpty())) {
                    Expression initializer=c.initializers.get(receiverExpression.toString());
                    if(initializer instanceof ObjectCreationExpr created&&!created.getArguments().isEmpty())operation=operation.times(callback(created.getArgument(created.getArguments().size()-1),receiver,c));
                }
            }
            if(name.equals("sort"))operation=n.times(n.logarithm()).times(call.getArguments().isEmpty()?Cost.one():callback(call.getArgument(0),receiver,c));
            if(name.equals("toArray"))operation=n;
            if(operation!=null) {
                boolean linear=Set.of("clear","toArray").contains(name)
                    ||Set.of("get","getOrDefault","set").contains(name)&&!Set.of("ArrayList","TreeMap").contains(concrete)
                    ||concrete.equals("ArrayList")&&name.equals("add")&&call.getArguments().size()>1
                    ||Set.of("PriorityQueue","ArrayDeque","Deque").contains(concrete)&&(name.equals("contains")||name.equals("remove")&&!call.getArguments().isEmpty())
                    ||Set.of("HashMap","HashSet","LinkedHashMap","LinkedHashSet","LinkedList","Map","List","Collection","Queue","Set").contains(concrete)&&!Set.of("size","isEmpty","values","keySet","entrySet","stream","iterator","peek","peekFirst","peekLast","getFirst","getLast","getKey","getValue").contains(name);
                if(linear)linearSize(receiverExpression,c);
                assumptions.add("JDK-контракты: ArrayList/ArrayDeque — амортизированно; HashMap/HashSet — O(n) при коллизиях. equals/hashCode/compareTo у ключей считаются O(1), иначе требуется отдельная стоимость ключа.");
                for(Expression argument:call.getArguments())if(argument instanceof LambdaExpr||argument instanceof MethodReferenceExpr)operation=operation.plus(callback(argument,receiver,c));
                if(Set.of("add","addLast","addFirst","put","putIfAbsent","merge","computeIfAbsent","offer").contains(name)) {
                    String key=receiverExpression.toString(); c.growth.merge(key,Cost.one(),Cost::plus); c.sizes.merge(key,Cost.one(),Cost::plus);
                }
                return arguments.plus(operation);
            }
        }
        if(raw.equals("Entry")&&Set.of("getKey","getValue").contains(name))return arguments;
        if(raw.equals("SplittableRandom")||raw.equals("Random"))return arguments;
        if(raw.equals("Class")&&Set.of("getSimpleName","getName").contains(name))return arguments;
        if(raw.endsWith("Exception")||raw.endsWith("Error")||raw.equals("Throwable")) {
            if(Set.of("getMessage","getClass","addSuppressed").contains(name))return arguments;
            if(name.equals("getSuppressed"))return arguments.plus(Cost.variable("|suppressed|"));
        }
        if(name.equals("getClass"))return arguments;
        if(raw.equals("BufferedReader")||raw.equals("StringReader")||raw.equals("InputStreamReader")) {
            if(name.equals("close"))return arguments;
            if(name.equals("readLine")) { assumptions.add("I/O оценивается по объёму строки L(readLine); ожидание внешнего ввода исключено."); return arguments.plus(Cost.variable("L(readLine)")); }
        }
        if(receiverExpression!=null&&typeOf(receiverExpression,c).endsWith("[]")&&name.equals("clone"))return arguments.plus(length(receiverExpression,c));
        if(Set.of("Predicate","Function","IntUnaryOperator","Consumer","ToIntFunction").contains(raw))return arguments.plus(Cost.variable("C("+receiverExpression+")"));
        return unknown(call,"Неизвестна стоимость вызова "+call+".");
    }
}

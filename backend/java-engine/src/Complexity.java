import com.github.javaparser.ast.*;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.stmt.*;
import java.util.*;

/** Conservative, compositional upper bounds for a deliberately supported AST subset. */
final class Complexity {
    static final int TERM_LIMIT = 16;
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
        Context copy() {
            Context c = new Context(); c.types.putAll(types); c.sizes.putAll(sizes); c.initializers.putAll(initializers); return c;
        }
    }
    final CallableDeclaration<?> root;
    final Set<CallableDeclaration<?>> stack = Collections.newSetFromMap(new IdentityHashMap<>());
    final LinkedHashSet<String> assumptions = new LinkedHashSet<>();
    final LinkedHashSet<String> limitations = new LinkedHashSet<>();
    final List<Map<String,Object>> evidence = new ArrayList<>();
    int calls = 0;
    Complexity(CallableDeclaration<?> method) { root = method; }
    static Map<String,Object> inspect(CallableDeclaration<?> method) { return new Complexity(method).inspect(); }
    Map<String,Object> inspect() {
        assumptions.add("Размеры входов неотрицательны; оценивается верхняя граница времени в модели постоянной стоимости примитивных операций.");
        Context c = new Context();
        root.findAncestor(TypeDeclaration.class).ifPresent(owner -> { for(FieldDeclaration field : ((TypeDeclaration<?>)owner).getFields()) for(VariableDeclarator v : field.getVariables()) c.types.put(v.getNameAsString(),v.getType().asString()); });
        for(Parameter p : root.getParameters()) {
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
    static boolean numeric(String type) { return Set.of("byte","short","int","long","float","double","char","boolean").contains(type); }
    static String baseType(String type) { return type.replaceAll("<.*>","").replace("java.util.","").trim(); }
    static boolean collection(String type) { return Set.of("List","Set","Map","Collection","Iterable","ArrayList","LinkedList","HashSet","TreeSet","HashMap","TreeMap").contains(baseType(type)); }
    String typeOf(Expression e, Context c) {
        e=unwrap(e);
        if(e instanceof ArrayAccessExpr a) { String array=typeOf(a.getName(),c); return array.endsWith("[]")?array.substring(0,array.length()-2):""; }
        return e instanceof NameExpr n ? c.types.getOrDefault(n.getNameAsString(),"") : "";
    }
    Cost length(Expression e, Context c) {
        e=unwrap(e);
        if(e instanceof ArrayAccessExpr a && typeOf(e,c).endsWith("[]")) {
            Expression base=a.getName(); String suffix="[]";
            while(base instanceof ArrayAccessExpr inner) { base=inner.getName(); suffix+="[]"; }
            if(base instanceof NameExpr name) {
                assumptions.add("Для многомерного массива используется максимальная длина вложенной строки; строки могут иметь разную длину.");
                return Cost.variable("max(|"+name.getNameAsString()+suffix+"|)");
            }
        }
        if(e instanceof NameExpr name && (typeOf(e,c).endsWith("[]") || collection(typeOf(e,c)) || typeOf(e,c).equals("String"))) {
            if(collection(typeOf(e,c))) assumptions.add("Коллекции используют стандартные реализации JDK; пользовательские переопределения и конкурентные изменения не моделируются.");
            Cost alias=c.sizes.get(name.getNameAsString());
            // For arrays/collections, parameter symbols represent lengths, not object addresses.
            return alias==null?Cost.variable("|"+name.getNameAsString()+"|"):alias;
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
        if(integer(e)!=null || e instanceof BooleanLiteralExpr || e instanceof CharLiteralExpr) return Cost.one();
        if(e instanceof NameExpr n) return c.sizes.getOrDefault(n.getNameAsString(),Cost.unknownCost());
        if(e instanceof ArrayCreationExpr a && !a.getLevels().isEmpty() && a.getLevels().get(0).getDimension().isPresent()) return size(a.getLevels().get(0).getDimension().get(),c);
        if(e instanceof FieldAccessExpr f && f.getNameAsString().equals("length") && typeOf(f.getScope(),c).endsWith("[]")) return length(f.getScope(),c);
        if(e instanceof MethodCallExpr call && call.getArguments().isEmpty() && call.getScope().isPresent() && Set.of("size","length").contains(call.getNameAsString())) return length(call.getScope().get(),c);
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
    Cost callable(CallableDeclaration<?> method, Context c) {
        if(method instanceof MethodDeclaration m) return m.getBody().map(b -> statement(b,c)).orElseGet(()->unknown(m,"Метод не имеет тела."));
        return unknown(method,"Стоимость конструктора не анализируется.");
    }
    Cost statement(Statement s, Context c) {
        if(s instanceof BlockStmt b) {
            Cost total=Cost.one();
            for(Statement child : b.getStatements()) { total=total.plus(statement(child,c)); if(child instanceof ReturnStmt || child instanceof ThrowStmt) break; }
            return total;
        }
        if(s instanceof EmptyStmt || s instanceof BreakStmt || s instanceof ContinueStmt) return Cost.one();
        if(s instanceof ExpressionStmt e) return expression(e.getExpression(),c);
        if(s instanceof ReturnStmt r) return r.getExpression().map(e->expression(e,c)).orElse(Cost.one());
        if(s instanceof IfStmt f) {
            if(f.getCondition() instanceof BooleanLiteralExpr b) return b.getValue()?statement(f.getThenStmt(),c):f.getElseStmt().map(x->statement(x,c)).orElse(Cost.one());
            Cost value=expression(f.getCondition(),c);
            Cost result=value.plus(statement(f.getThenStmt(),c.copy())).plus(f.getElseStmt().map(x->statement(x,c.copy())).orElse(Cost.one()));
            invalidateBranchAssignments(f,c); explain(s,result,"Худшая ветка условия; независимые размеры сохраняются в сумме."); return result;
        }
        if(s instanceof ForStmt f) return forLoop(f,c);
        if(s instanceof ForEachStmt f) {
            Cost iterations=length(f.getIterable(),c);
            if(iterations.unknown) return unknown(s,"Неизвестна стоимость обхода Iterable или размер коллекции.");
            if(mutates(f.getBody(),names(f.getIterable()))) return unknown(s,"Коллекция или её ссылка изменяется во время обхода.");
            Context body=c.copy(); for(VariableDeclarator v:f.getVariable().getVariables()) {
                body.types.put(v.getNameAsString(),v.getType().asString());
                if(numeric(v.getType().asString())) {
                    body.sizes.put(v.getNameAsString(),Cost.variable("max(|"+f.getIterable()+"[*]|)"));
                    assumptions.add("Стоимость обработки числовых элементов может зависеть от их максимального модуля; для int число десятичных цифр ограничено 10.");
                }
            }
            Cost result=iterations.times(statement(f.getBody(),body)); invalidateBranchAssignments(f.getBody(),c);
            explain(s,result,"Число итераций равно длине массива/стандартной коллекции."); return result;
        }
        if(s instanceof WhileStmt w) return whileLoop(w,c);
        if(s instanceof DoStmt) return unknown(s,"do-while требует отдельного доказательства числа итераций.");
        if(s instanceof SwitchStmt sw) {
            Cost cost=expression(sw.getSelector(),c);
            // Summing all entries is a safe upper bound even with fall-through.
            for(SwitchEntry entry:sw.getEntries()) { Context branch=c.copy(); for(Statement child:entry.getStatements()) cost=cost.plus(statement(child,branch)); }
            invalidateBranchAssignments(sw,c); return cost;
        }
        if(s instanceof TryStmt || s instanceof ThrowStmt || s instanceof SynchronizedStmt || s instanceof LabeledStmt) return unknown(s,"Поток исключений, синхронизация или метки не входят в поддерживаемую модель стоимости.");
        return unknown(s,"Неподдерживаемая конструкция: "+s.getClass().getSimpleName());
    }
    void invalidateBranchAssignments(Node n, Context c) {
        for(AssignExpr a:n.findAll(AssignExpr.class)) if(a.getTarget() instanceof NameExpr v) { c.sizes.remove(v.getNameAsString()); c.initializers.remove(v.getNameAsString()); }
        for(UnaryExpr u:n.findAll(UnaryExpr.class)) if(u.getOperator().isPostfix() || u.getOperator()==UnaryExpr.Operator.PREFIX_INCREMENT || u.getOperator()==UnaryExpr.Operator.PREFIX_DECREMENT) if(u.getExpression() instanceof NameExpr v) { c.sizes.remove(v.getNameAsString()); c.initializers.remove(v.getNameAsString()); }
    }
    static Set<String> names(Node n) { Set<String> result=new HashSet<>(); n.findAll(NameExpr.class).forEach(x->result.add(x.getNameAsString())); return result; }
    static boolean mutates(Node body, Set<String> variables) {
        for(AssignExpr a:body.findAll(AssignExpr.class)) if(!Collections.disjoint(names(a.getTarget()),variables)) return true;
        for(UnaryExpr u:body.findAll(UnaryExpr.class)) if((u.getOperator().isPostfix() || u.getOperator()==UnaryExpr.Operator.PREFIX_INCREMENT || u.getOperator()==UnaryExpr.Operator.PREFIX_DECREMENT) && !Collections.disjoint(names(u.getExpression()),variables)) return true;
        for(MethodCallExpr call:body.findAll(MethodCallExpr.class)) if(call.getScope().isPresent() && !Collections.disjoint(names(call.getScope().get()),variables) && !Set.of("size","length","get","contains","containsKey","containsValue","isEmpty","charAt").contains(call.getNameAsString())) return true;
        return false;
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
        boolean ascending=b.getOperator()==BinaryExpr.Operator.LESS;
        boolean descending=b.getOperator()==BinaryExpr.Operator.GREATER;
        if(!(ascending && step.increasing || descending && !step.increasing)) return unknown(condition,"Направление шага не гарантирует приближение к границе; поддерживаются строгие < и >.");
        if(!Set.of("int","long").contains(c.types.get(step.variable))) return unknown(condition,"Счётчик должен иметь целочисленный тип int или long.");
        if(c.types.get(step.variable).equals("int") && (!b.getRight().findAll(LongLiteralExpr.class).isEmpty() || names(b.getRight()).stream().anyMatch(v -> "long".equals(c.types.get(v))))) return unknown(condition,"Граница long может превышать диапазон счётчика int и привести к переполнению.");
        if(!updateInside && mutates(body,Set.of(step.variable))) return unknown(body,"Счётчик дополнительно изменяется в теле цикла.");
        Set<String> boundVariables=names(b.getRight());
        if(boundVariables.contains(step.variable) || mutates(body,boundVariables)) return unknown(body,"Граница цикла изменяется или зависит от изменяемого счётчика.");
        for(String variable : boundVariables) if(collection(c.types.getOrDefault(variable,"")) || c.types.getOrDefault(variable,"").endsWith("[]")) {
            for(MethodCallExpr call : body.findAll(MethodCallExpr.class)) if(call.getArguments().stream().anyMatch(a -> names(a).contains(variable))) return unknown(call,"Коллекция из границы цикла передаётся в метод; её размер может измениться.");
        }
        Long lower=integer(b.getRight()), first=integer(start);
        if(step.logarithmic && (lower==null || lower<0)) return unknown(condition,"Делящийся счётчик должен уменьшаться до неотрицательной константы.");
        if(!step.logarithmic && step.amount!=1) return unknown(condition,"Шаг больше единицы требует проверки переполнения Java-счётчика.");
        if(step.logarithmic) { Cost magnitude=size(start,c); return magnitude.unknown?unknown(condition,"Не удалось ограничить начальный модуль счётчика."):magnitude.logarithm(); }
        if(first!=null && lower!=null) return Cost.one();
        // Sizes represent nonnegative magnitudes; a dynamic start and bound both contribute.
        Cost result=size(start,c).plus(size(b.getRight(),c));
        return result.unknown?unknown(condition,"Не удалось выразить число итераций через размеры входов."):result;
    }
    Cost forLoop(ForStmt f, Context c) {
        if(f.getInitialization().size()!=1 || f.getUpdate().size()!=1 || f.getCompare().isEmpty()) return unknown(f,"for требует одного счётчика, шага и явной границы.");
        Context loop=c.copy(); Expression init=f.getInitialization().get(0), start; String variable;
        if(init instanceof VariableDeclarationExpr declaration && declaration.getVariables().size()==1 && declaration.getVariable(0).getInitializer().isPresent()) {
            VariableDeclarator v=declaration.getVariable(0); variable=v.getNameAsString(); start=v.getInitializer().get(); loop.types.put(variable,v.getType().asString());
        } else if(init instanceof AssignExpr a && a.getOperator()==AssignExpr.Operator.ASSIGN && a.getTarget() instanceof NameExpr n) { variable=n.getNameAsString(); start=a.getValue(); }
        else return unknown(f,"Неизвестная инициализация счётчика.");
        Update step=update(f.getUpdate().get(0));
        if(step==null || !step.variable.equals(variable)) return unknown(f,"Шаг цикла не распознан; умножающийся счётчик может переполниться.");
        Cost count=iterations(f.getCompare().get(),start,step,f.getBody(),loop,false);
        if(count.unknown) return count;
        Cost setup=expression(start,loop), condition=expression(f.getCompare().get(),loop);
        loop.sizes.put(variable,size(start,c).plus(size(((BinaryExpr)unwrap(f.getCompare().get())).getRight(),c)));
        Cost result=setup.plus(count.times(condition.plus(statement(f.getBody(),loop))));
        invalidateBranchAssignments(f,c);
        explain(f,result,step.logarithmic?"Счётчик делится на постоянный множитель > 1.":count.format().equals("O(1)")?"Постоянные границы цикла.":"Монотонный счётчик с постоянным шагом; стоимость тела умножается на число итераций.");
        return result;
    }
    Cost whileLoop(WhileStmt w, Context c) {
        if(unwrap(w.getCondition()) instanceof BinaryExpr test && test.getOperator()==BinaryExpr.Operator.AND) return twoPointerLoop(w,test,c);
        if(!(unwrap(w.getCondition()) instanceof BinaryExpr b) || !(unwrap(b.getLeft()) instanceof NameExpr name)) return unknown(w,"Не распознан счётчик while.");
        List<Statement> body=w.getBody() instanceof BlockStmt block?new ArrayList<>(block.getStatements()):List.of(w.getBody());
        String variable=name.getNameAsString(); Update step=null; int stepAt=-1;
        for(int i=0;i<body.size();i++) if(body.get(i) instanceof ExpressionStmt expression) {
            Update candidate=update(expression.getExpression());
            if(candidate!=null && candidate.variable.equals(variable)) { if(step!=null) return unknown(w,"Несколько шагов счётчика while."); step=candidate; stepAt=i; }
        }
        if(step==null || !w.findAll(ContinueStmt.class).isEmpty()) return unknown(w,"Шаг while может пропускаться или не распознан.");
        for(int i=0;i<body.size();i++) if(i!=stepAt && mutates(body.get(i),Set.of(variable))) return unknown(w,"Счётчик while имеет дополнительные изменения.");
        Expression start=c.initializers.get(variable);
        if(start==null && c.sizes.containsKey(variable)) start=new NameExpr(variable);
        if(start==null) return unknown(w,"Неизвестно начальное значение счётчика while.");
        Cost count=iterations(w.getCondition(),start,step,w.getBody(),c,true);
        Context loop=c.copy(); loop.sizes.put(variable,size(start,c).plus(size(b.getRight(),c)));
        Cost bodyCost=Cost.one(); for(Statement child:body) bodyCost=bodyCost.plus(statement(child,loop));
        Cost result=count.times(expression(w.getCondition(),c).plus(bodyCost));
        invalidateBranchAssignments(w,c); explain(w,result,"Шаг while выполняется безусловно в каждой полной итерации."); return result;
    }
    static boolean advances(Statement statement, Set<String> counters) {
        if(statement instanceof ExpressionStmt expression) { Update step=update(expression.getExpression()); return step!=null && counters.contains(step.variable) && step.increasing && !step.logarithmic && step.amount==1; }
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
        if(statement instanceof ExpressionStmt expression) { Update step=update(expression.getExpression()); if(step!=null && step.variable.equals(counter)) return 1; }
        return mutates(statement,Set.of(counter))?2:0;
    }
    Cost twoPointerLoop(WhileStmt loop, BinaryExpr condition, Context c) {
        if(!(unwrap(condition.getLeft()) instanceof BinaryExpr left) || !(unwrap(condition.getRight()) instanceof BinaryExpr right)) return unknown(loop,"Составная граница while не распознана.");
        List<BinaryExpr> guards=List.of(left,right); Set<String> counters=new HashSet<>(); Cost count=Cost.one(); Context body=c.copy();
        for(BinaryExpr guard:guards) {
            if(guard.getOperator()!=BinaryExpr.Operator.LESS || !(unwrap(guard.getLeft()) instanceof NameExpr variable)) return unknown(loop,"Два указателя требуют строгих верхних границ.");
            String name=variable.getNameAsString(); Expression start=c.initializers.get(name);
            if(!counters.add(name) || !"int".equals(c.types.get(name)) || start==null || integer(start)==null || integer(start)!=0) return unknown(loop,"Два независимых указателя должны начинаться с нуля.");
            if(!(unwrap(guard.getRight()) instanceof FieldAccessExpr length) || !length.getNameAsString().equals("length") || !typeOf(length.getScope(),c).endsWith("[]")) return unknown(loop,"Граница указателя должна быть неизменной длиной массива.");
            Set<String> arrays=names(length.getScope());
            if(mutates(loop.getBody(),arrays) || loop.getBody().findAll(MethodCallExpr.class).stream().anyMatch(call->call.getArguments().stream().anyMatch(arg->!Collections.disjoint(names(arg),arrays)))) return unknown(loop,"Массив из границы указателя может изменяться.");
            Cost bound=size(guard.getRight(),c); count=count.plus(bound); body.sizes.put(name,bound);
        }
        if(!loop.getBody().findAll(ContinueStmt.class).isEmpty() || !loop.getBody().findAll(BreakStmt.class).isEmpty() || !loop.getBody().findAll(ReturnStmt.class).isEmpty() || !advances(loop.getBody(),counters)) return unknown(loop,"Не каждая ветка гарантирует продвижение хотя бы одного указателя.");
        for(String counter:counters) if(maxIncrements(loop.getBody(),counter)>1) return unknown(loop,"Указатель может сделать несколько шагов за итерацию и переполниться.");
        for(AssignExpr assignment:loop.getBody().findAll(AssignExpr.class)) if(!Collections.disjoint(names(assignment.getTarget()),counters)) return unknown(loop,"Присваивание может сбросить указатель.");
        for(UnaryExpr unary:loop.getBody().findAll(UnaryExpr.class)) if(!Collections.disjoint(names(unary.getExpression()),counters) && (unary.getOperator().isPostfix() || unary.getOperator()==UnaryExpr.Operator.PREFIX_INCREMENT || unary.getOperator()==UnaryExpr.Operator.PREFIX_DECREMENT)) {
            Update step=update(unary); if(step==null || !step.increasing) return unknown(loop,"Указатель может двигаться назад.");
        }
        Cost result=count.times(expression(condition,c).plus(statement(loop.getBody(),body)));
        invalidateBranchAssignments(loop,c); explain(loop,result,"Каждая ветка продвигает хотя бы один из двух указателей; число шагов ограничено суммой длин массивов."); return result;
    }
    Cost expression(Expression raw, Context c) {
        Expression e=unwrap(raw);
        if(e instanceof LiteralExpr || e instanceof NameExpr || e instanceof ThisExpr || e instanceof ClassExpr) return Cost.one();
        if(e instanceof VariableDeclarationExpr declaration) {
            Cost cost=Cost.one();
            for(VariableDeclarator v:declaration.getVariables()) {
                String name=v.getNameAsString(); c.types.put(name,v.getType().asString());
                if(v.getInitializer().isPresent()) { Expression init=v.getInitializer().get(); cost=cost.plus(expression(init,c)); Cost value=size(init,c); if(!value.unknown)c.sizes.put(name,value); else c.sizes.remove(name); c.initializers.put(name,init); }
            }
            return cost;
        }
        if(e instanceof BinaryExpr b) {
            if(b.getOperator()==BinaryExpr.Operator.PLUS && (b.getLeft() instanceof StringLiteralExpr || b.getRight() instanceof StringLiteralExpr || typeOf(b.getLeft(),c).equals("String") || typeOf(b.getRight(),c).equals("String"))) return unknown(e,"Стоимость конкатенации строк зависит от длины результата.");
            return expression(b.getLeft(),c).plus(expression(b.getRight(),c));
        }
        if(e instanceof UnaryExpr u) return expression(u.getExpression(),c);
        if(e instanceof AssignExpr a) {
            Cost cost=expression(a.getTarget(),c).plus(expression(a.getValue(),c));
            if(a.getTarget() instanceof NameExpr n) {
                Cost value=size(a.getValue(),c);
                if(a.getOperator()==AssignExpr.Operator.ASSIGN && !value.unknown)c.sizes.put(n.getNameAsString(),value); else c.sizes.remove(n.getNameAsString());
                if(a.getOperator()==AssignExpr.Operator.ASSIGN)c.initializers.put(n.getNameAsString(),a.getValue()); else c.initializers.remove(n.getNameAsString());
            }
            return cost;
        }
        if(e instanceof ArrayAccessExpr a) return expression(a.getName(),c).plus(expression(a.getIndex(),c));
        if(e instanceof ArrayCreationExpr a) {
            Cost volume=Cost.one();
            for(var level:a.getLevels()) if(level.getDimension().isPresent()) volume=volume.times(size(level.getDimension().get(),c));
            if(a.getInitializer().isPresent()) volume=volume.plus(expression(a.getInitializer().get(),c));
            return volume;
        }
        if(e instanceof ArrayInitializerExpr a) { Cost cost=Cost.one(); for(Expression value:a.getValues())cost=cost.plus(expression(value,c));return cost; }
        if(e instanceof FieldAccessExpr f) return expression(f.getScope(),c);
        if(e instanceof CastExpr cast) return expression(cast.getExpression(),c);
        if(e instanceof ConditionalExpr cond) return expression(cond.getCondition(),c).plus(expression(cond.getThenExpr(),c.copy())).plus(expression(cond.getElseExpr(),c.copy()));
        if(e instanceof MethodCallExpr call) return methodCall(call,c);
        if(e instanceof InstanceOfExpr instance) return expression(instance.getExpression(),c);
        return unknown(e,"Неизвестная стоимость выражения: "+e.getClass().getSimpleName());
    }
    Cost methodCall(MethodCallExpr call, Context c) {
        Cost arguments=Cost.one(); for(Expression arg:call.getArguments())arguments=arguments.plus(expression(arg,c));
        String name=call.getNameAsString(), scope=call.getScope().map(Object::toString).orElse("");
        if(Set.of("Math","java.lang.Math","StrictMath","java.lang.StrictMath").contains(scope) && Set.of("abs","min","max","floor","ceil","round","sqrt","signum").contains(name)) return arguments;
        if(call.getScope().isPresent()) {
            Expression receiver=call.getScope().get(); String type=baseType(typeOf(receiver,c)); Cost n=length(receiver,c);
            if(!n.unknown) {
                assumptions.add("Стоимость стандартных операций JDK используется условно: без пользовательских переопределений, с O(1) сравнением примитивов/ключей.");
                Cost operation=null;
                if(Set.of("size","length","isEmpty").contains(name) && call.getArguments().isEmpty()) operation=Cost.one();
                if(type.equals("String") && name.equals("charAt") || type.equals("ArrayList") && name.equals("get")) operation=Cost.one();
                if(Set.of("List","LinkedList","ArrayList","Collection","Iterable").contains(type) && name.equals("contains")) operation=n;
                if(type.equals("LinkedList") && name.equals("get")) operation=n;
                if(Set.of("TreeMap","TreeSet").contains(type) && Set.of("get","contains","containsKey","put","add","remove").contains(name)) operation=n.logarithm();
                if(type.equals("String") && Set.of("equals","compareTo","contains","indexOf").contains(name)) {
                    // String search can depend on both needle and haystack length; do not assume a linear implementation.
                    operation=null;
                }
                if(operation!=null) { Cost result=arguments.plus(operation); explain(call,result,"Модель операции JDK: "+type+"."+name); return result; }
            }
        }
        if(Set.of("Arrays","java.util.Arrays","Collections","java.util.Collections").contains(scope) && name.equals("sort") && !call.getArguments().isEmpty()) {
            Cost n=length(call.getArgument(0),c);
            if(!n.unknown) { assumptions.add("Сортировка стандартной коллекции/массива; стоимость сравнения O(1), пользовательский Comparator не анализируется."); if(call.getArguments().size()!=1) return unknown(call,"Неизвестна стоимость Comparator или диапазона сортировки."); Cost cost=n.times(n.logarithm()).plus(arguments); explain(call,cost,"Верхняя граница стандартной сортировки."); return cost; }
        }
        Node owner=root.findAncestor(TypeDeclaration.class).orElse(null);
        if(owner==null || !(scope.isEmpty() || scope.equals("this") || scope.equals(((TypeDeclaration<?>)owner).getNameAsString()))) return unknown(call,"Неизвестна стоимость вызова "+call+".");
        List<MethodDeclaration> candidates=((TypeDeclaration<?>)owner).getMethodsByName(name).stream().filter(m->m.getParameters().size()==call.getArguments().size()).toList();
        if(candidates.size()!=1) return unknown(call,"Вызов "+name+" нельзя однозначно связать с локальным методом.");
        MethodDeclaration target=candidates.get(0);
        if(stack.contains(target)) return unknown(call,"Рекурсия требует отдельного анализа рекуррентного соотношения.");
        if(++calls>64) return unknown(call,"Превышен бюджет межпроцедурного анализа.");
        if(!target.isStatic() && !target.isPrivate() && !target.isFinal()) assumptions.add("Вызовы методов анализируются для текущей реализации класса; динамическая диспетчеризация не моделируется.");
        Context callee=new Context();
        for(int i=0;i<target.getParameters().size();i++) {
            Parameter p=target.getParameter(i); callee.types.put(p.getNameAsString(),p.getType().asString());
            Cost value=typeOf(call.getArgument(i),c).endsWith("[]") || collection(typeOf(call.getArgument(i),c)) ? length(call.getArgument(i),c) : size(call.getArgument(i),c);
            if(!value.unknown)callee.sizes.put(p.getNameAsString(),value);
        }
        stack.add(target); Cost result=arguments.plus(callable(target,callee)); stack.remove(target);
        explain(call,result,"Стоимость локального метода "+name+" с подстановкой аргументов."); return result;
    }
}

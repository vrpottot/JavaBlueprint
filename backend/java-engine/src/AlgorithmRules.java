import com.github.javaparser.ast.*;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.stmt.*;
import java.util.*;

/** Structural rules, independent of method names; every rule states its input invariants. */
final class AlgorithmRules {
    static boolean same(Node a,Node b) { return a.toString().replace(" ","").equals(b.toString().replace(" ","")); }
    static boolean requiresUnseen(Expression condition,ArrayAccessExpr access) {
        condition=Complexity.unwrap(condition);
        if(condition instanceof UnaryExpr not&&not.getOperator()==UnaryExpr.Operator.LOGICAL_COMPLEMENT)return same(Complexity.unwrap(not.getExpression()),access);
        return condition instanceof BinaryExpr both&&both.getOperator()==BinaryExpr.Operator.AND&&(requiresUnseen(both.getLeft(),access)||requiresUnseen(both.getRight(),access));
    }
    static List<MethodCallExpr> calls(Node node,String receiver,Set<String> names) {
        return node.findAll(MethodCallExpr.class).stream().filter(call->call.getScope().map(Object::toString).orElse("").equals(receiver)&&names.contains(call.getNameAsString())).toList();
    }
    static boolean simpleBody(Node body) { return body.findAll(WhileStmt.class).isEmpty()&&body.findAll(ForStmt.class).isEmpty()&&body.findAll(ForEachStmt.class).isEmpty()&&body.findAll(TryStmt.class).isEmpty(); }
    static boolean unconditional(Node operation,Statement body) {
        Node current=operation;
        while(current!=body&&current.getParentNode().isPresent()) {
            current=current.getParentNode().get();
            if(current instanceof IfStmt||current instanceof ConditionalExpr||current instanceof LambdaExpr||current instanceof TryStmt)return false;
            if(current instanceof BinaryExpr binary&&(binary.getOperator()==BinaryExpr.Operator.AND||binary.getOperator()==BinaryExpr.Operator.OR))return false;
        }
        return current==body;
    }
    static Complexity.Cost geometric(Complexity.Cost body,Complexity.Cost magnitude,String marker) {
        if(body.unknown()||magnitude.unknown())return Complexity.Cost.unknownCost();
        Complexity.Cost total=Complexity.Cost.one();
        for(Complexity.Term term:body.terms()) {
            SortedMap<String,Complexity.Powers> other=new TreeMap<>(term.factors());
            Complexity.Powers powers=other.remove(marker); Complexity.Cost part=new Complexity.Cost(List.of(new Complexity.Term(other)),false);
            int linear=powers==null?0:powers.linear(), logarithmic=powers==null?0:powers.logarithmic();
            for(int i=0;i<linear;i++)part=part.times(magnitude);
            for(int i=0;i<logarithmic+(linear==0?1:0);i++)part=part.times(magnitude.logarithm());
            total=total.plus(part);
        }
        return total;
    }
    static Complexity.Cost recursion(Complexity model,MethodDeclaration method,Complexity.Context c) {
        List<MethodCallExpr> recursive=method.getBody().orElseThrow().findAll(MethodCallExpr.class).stream().filter(call->call.getNameAsString().equals(method.getNameAsString())&&call.getArguments().size()==method.getParameters().size()&&call.getScope().map(Object::toString).map(scope->scope.equals("this")||scope.equals(Symbols.owner(method).getNameAsString())).orElse(true)).toList();
        if(recursive.isEmpty())return null;
        Set<String> parameters=new HashSet<>(); method.getParameters().forEach(parameter->parameters.add(parameter.getNameAsString()));
        if(method.findAll(AssignExpr.class).stream().anyMatch(write->write.getTarget() instanceof NameExpr name&&parameters.contains(name.getNameAsString()))||method.findAll(UnaryExpr.class).stream().anyMatch(write->Complexity.update(write)!=null&&parameters.contains(Complexity.update(write).variable())))return model.unknown(method,"Параметр рекурсии изменяется: структурная рекуррентная оценка неприменима.");
        Complexity.Cost traversal=recursiveTraversal(model,method,c,recursive); if(traversal!=null)return traversal;
        for(IfStmt branch:method.getBody().get().findAll(IfStmt.class)) {
            if(!Complexity.terminates(branch.getThenStmt())||!(branch.getCondition() instanceof BinaryExpr test)||!unconditional(branch,method.getBody().get())||recursive.stream().anyMatch(call->!branch.getBegin().orElseThrow().isBefore(call.getBegin().orElseThrow())))continue;
            // Half-open range recurrence: two disjoint halves, safe midpoint, explicit base case.
            if(test.getLeft() instanceof BinaryExpr distance&&distance.getOperator()==BinaryExpr.Operator.MINUS&&test.getRight() instanceof IntegerLiteralExpr&&Set.of(BinaryExpr.Operator.LESS_EQUALS,BinaryExpr.Operator.LESS).contains(test.getOperator())) {
                String end=distance.getLeft().toString(),begin=distance.getRight().toString();
                int beginAt=-1,endAt=-1;
                for(int i=0;i<method.getParameters().size();i++) { if(method.getParameter(i).getNameAsString().equals(begin))beginAt=i; if(method.getParameter(i).getNameAsString().equals(end))endAt=i; }
                if(beginAt<0||endAt<0||recursive.size()!=2)continue;
                for(VariableDeclarator middle:method.getBody().get().findAll(VariableDeclarator.class)) {
                    if(!middle.getInitializer().map(Object::toString).orElse("").replace(" ","").equals(begin+"+("+end+"-"+begin+")/2"))continue;
                    String mid=middle.getNameAsString(); boolean first=false,second=false;
                    if(method.findAll(AssignExpr.class).stream().anyMatch(write->write.getTarget().toString().equals(mid))||method.findAll(UnaryExpr.class).stream().anyMatch(write->Complexity.update(write)!=null&&Complexity.update(write).variable().equals(mid)))continue;
                    for(MethodCallExpr call:recursive) { first|=call.getArgument(beginAt).toString().equals(begin)&&call.getArgument(endAt).toString().equals(mid); second|=call.getArgument(beginAt).toString().equals(mid)&&call.getArgument(endAt).toString().equals(end); }
                    if(!first||!second)continue;
                    Complexity.Cost n=c.sizes.getOrDefault(begin,Complexity.Cost.unknownCost()).plus(c.sizes.getOrDefault(end,Complexity.Cost.unknownCost()));
                    model.recursiveUnit.add(method); Complexity.Cost work=model.statement(method.getBody().get(),c.copy()); model.recursiveUnit.remove(method);
                    Complexity.Cost result;
                    if(work.unknown())return work;
                    if(n.plus(work).equals(n))result=n.times(n.logarithm());
                    else result=n.times(work); // At most O(n) recursion nodes, each bounded by root work.
                    model.explain(method,result,"Рекуррентное соотношение двух непересекающихся половин; линейное слияние даёт O(n log n)."); return result;
                }
            }
        }
        for(int parameterAt=0;parameterAt<method.getParameters().size();parameterAt++) {
            String variable=method.getParameter(parameterAt).getNameAsString();
            boolean base=method.getBody().get().findAll(IfStmt.class).stream().anyMatch(branch->unconditional(branch,method.getBody().get())&&recursive.stream().allMatch(call->branch.getBegin().orElseThrow().isBefore(call.getBegin().orElseThrow()))&&Complexity.terminates(branch.getThenStmt())&&branch.getCondition() instanceof BinaryExpr test&&test.getLeft().toString().equals(variable)&&Complexity.integer(test.getRight())!=null&&Set.of(BinaryExpr.Operator.LESS_EQUALS,BinaryExpr.Operator.LESS).contains(test.getOperator()));
            base|=method.getBody().get().findAll(ConditionalExpr.class).stream().anyMatch(conditional->conditional.getCondition() instanceof BinaryExpr test&&test.getLeft().toString().equals(variable)&&Long.valueOf(0).equals(Complexity.integer(test.getRight()))&&test.getOperator()==BinaryExpr.Operator.GREATER&&conditional.getElseExpr().findAll(MethodCallExpr.class).isEmpty());
            if(!base)continue;
            boolean decreasing=true,halving=true;
            for(MethodCallExpr call:recursive) {
                Expression argument=Complexity.unwrap(call.getArgument(parameterAt));
                decreasing&=argument instanceof BinaryExpr binary&&binary.getOperator()==BinaryExpr.Operator.MINUS&&binary.getLeft().toString().equals(variable)&&Complexity.integer(binary.getRight())!=null&&Complexity.integer(binary.getRight())>0;
                halving&=argument instanceof BinaryExpr binary&&binary.getOperator()==BinaryExpr.Operator.DIVIDE&&binary.getLeft().toString().equals(variable)&&Complexity.integer(binary.getRight())!=null&&Complexity.integer(binary.getRight())>1;
            }
            if(!decreasing&&!halving)continue;
            boolean memo=false;
            for(Parameter cache:method.getParameters()) if(cache.getType().isArrayType()) {
                String name=cache.getNameAsString();
                List<AssignExpr> writes=method.getBody().get().findAll(AssignExpr.class).stream().filter(write->write.getTarget() instanceof ArrayAccessExpr access&&access.getName().toString().equals(name)).toList();
                boolean lookup=method.getBody().get().findAll(IfStmt.class).stream().anyMatch(branch->unconditional(branch,method.getBody().get())&&recursive.stream().allMatch(call->branch.getBegin().orElseThrow().isBefore(call.getBegin().orElseThrow()))&&Complexity.terminates(branch.getThenStmt())&&branch.getCondition().toString().contains(name+"["+variable+"]")&&branch.getThenStmt().toString().contains("return "+name+"["+variable+"]"));
                int index=method.getParameters().indexOf(cache);
                boolean shared=recursive.stream().allMatch(call->call.getArgument(index).toString().equals(name));
                boolean boundedValues=c.maximum.getOrDefault(variable,Long.MAX_VALUE)<=45;
                boolean escaped=method.findAll(MethodCallExpr.class).stream().anyMatch(call->!recursive.contains(call)&&call.getArguments().stream().anyMatch(argument->argument.toString().equals(name)));
                memo=lookup&&writes.size()==1&&writes.get(0).getTarget().toString().equals(name+"["+variable+"]")&&shared&&boundedValues&&!escaped;
                if(memo)break;
            }
            model.recursiveUnit.add(method); Complexity.Cost work=model.statement(method.getBody().get(),c.copy()); model.recursiveUnit.remove(method);
            Complexity.Cost n=c.sizes.getOrDefault(variable,Complexity.Cost.variable(variable)),result;
            if(memo)result=n.times(work);
            else if(recursive.size()==1)result=(halving?n.logarithm():n).times(work);
            else if(decreasing)result=Complexity.Cost.variable(recursive.size()+"^("+n.format().replaceFirst("^O\\(","").replaceFirst("\\)$","")+")").times(work);
            else return model.unknown(method,"Для нескольких рекурсивных ветвей не распознано соотношение размеров подзадач.");
            model.explain(method,result,memo?"Общий кэш: каждое состояние вычисляется один раз; guard ограничивает значения без столкновения с sentinel.":"Рекурсивный аргумент строго уменьшается до явного базового случая."); return result;
        }
        return model.unknown(method,"Не доказано уменьшение рекурсивной меры или корректность общего кэша.");
    }
    static Complexity.Cost recursiveTraversal(Complexity model,MethodDeclaration method,Complexity.Context c,List<MethodCallExpr> recursive) {
        if(recursive.size()!=1)return null;
        List<ForEachStmt> loops=method.getBody().orElseThrow().getStatements().stream().filter(statement->statement instanceof ForEachStmt).map(statement->(ForEachStmt)statement).toList();
        if(loops.size()!=1||!loops.get(0).isAncestorOf(recursive.get(0)))return null;
        ForEachStmt scan=loops.get(0);
        for(int parameterAt=0;parameterAt<method.getParameters().size();parameterAt++) {
            Parameter seen=method.getParameter(parameterAt); if(!seen.getType().asString().equals("boolean[]"))continue;
            String name=seen.getNameAsString();
            if(!recursive.get(0).getArgument(parameterAt).toString().equals(name))continue;
            if(method.findAll(AssignExpr.class).stream().anyMatch(write->write.getValue().toString().equals(name))||method.findAll(VariableDeclarator.class).stream().anyMatch(variable->variable.getInitializer().map(Object::toString).orElse("").equals(name)))continue;
            List<AssignExpr> marks=method.getBody().get().findAll(AssignExpr.class).stream().filter(write->write.getTarget() instanceof ArrayAccessExpr access&&access.getName().toString().equals(name)).toList();
            if(marks.size()!=1||!marks.get(0).getValue().isBooleanLiteralExpr()||!marks.get(0).getValue().asBooleanLiteralExpr().getValue()||!unconditional(marks.get(0),method.getBody().get()))continue;
            ArrayAccessExpr access=(ArrayAccessExpr)marks.get(0).getTarget();
            boolean guarded=method.getBody().get().getStatements().stream().anyMatch(statement->statement instanceof IfStmt branch&&same(branch.getCondition(),access)&&Complexity.terminates(branch.getThenStmt())&&branch.getBegin().orElseThrow().isBefore(marks.get(0).getBegin().orElseThrow()));
            if(!guarded)continue;
            if(method.getBody().get().findAll(MethodCallExpr.class).stream().anyMatch(call->!recursive.contains(call)&&call.getArguments().stream().anyMatch(argument->argument.toString().equals(name))))return null;
            if(!(scan.getIterable() instanceof MethodCallExpr get)||!get.getNameAsString().equals("get")||get.getScope().isEmpty())continue;
            Complexity.Cost vertices=c.sizes.getOrDefault(name,Complexity.Cost.variable("|"+name+"|")),edges=Complexity.Cost.variable("E("+get.getScope().get()+")");
            Complexity.Context body=c.copy(); model.recursiveUnit.add(method); Complexity.Cost perVertex=Complexity.Cost.one();
            for(Statement statement:method.getBody().get().getStatements())if(statement!=scan)perVertex=perVertex.plus(model.statement(statement,body));
            for(VariableDeclarator element:scan.getVariable().getVariables())body.types.put(element.getNameAsString(),element.getType().asString());
            Complexity.Cost perEdge=model.expression(scan.getIterable(),body).plus(model.statement(scan.getBody(),body)); model.recursiveUnit.remove(method);
            Complexity.Cost result=vertices.times(perVertex).plus(edges.times(perEdge));
            model.explain(method,result,"Рекурсивный обход: visited проверяется до работы и устанавливается до рекурсии; каждое ребро сканируется однократно.");return result;
        }
        return null;
    }
    static Complexity.Cost parentChain(Complexity model,WhileStmt loop,Complexity.Context c) {
        if(!(loop.getCondition() instanceof BinaryExpr condition)||condition.getOperator()!=BinaryExpr.Operator.NOT_EQUALS||!(condition.getLeft() instanceof ArrayAccessExpr array)||!(condition.getRight() instanceof NameExpr index)||!array.getIndex().toString().equals(index.getNameAsString()))return null;
        String name=array.getName().toString(),counter=index.getNameAsString();
        if(c.owner==null||!model.typeOf(array.getName(),c).equals("int[]"))return null;
        boolean initialized=c.owner.getConstructors().stream().flatMap(constructor->constructor.findAll(AssignExpr.class).stream()).anyMatch(write->write.getTarget() instanceof ArrayAccessExpr target&&target.getName().toString().equals(name)&&same(target.getIndex(),write.getValue()));
        if(!initialized)return null;
        List<AssignExpr> updates=loop.getBody().findAll(AssignExpr.class).stream().filter(write->write.getTarget().toString().equals(counter)).toList();
        if(updates.size()!=1)return null;
        Expression value=updates.get(0).getValue(); boolean follows=same(value,array);
        if(value instanceof NameExpr temporary)follows=loop.getBody().findAll(VariableDeclarator.class).stream().anyMatch(variable->variable.getNameAsString().equals(temporary.getNameAsString())&&variable.getInitializer().map(init->same(init,array)).orElse(false));
        if(!follows||!unconditional(updates.get(0),loop.getBody()))return null;
        for(AssignExpr write:loop.getBody().findAll(AssignExpr.class))if(write.getTarget() instanceof ArrayAccessExpr target&&target.getName().toString().equals(name)) {
            if(!(write.getValue() instanceof NameExpr root)||!name.equals(c.roots.get(root.getNameAsString())))return null;
        }
        if(!loop.getBody().findAll(MethodCallExpr.class).isEmpty())return null;
        model.assumptions.add("parent — корректный ациклический лес с индексами в диапазоне; обход и path compression оцениваются сверху O(n), без утверждения амортизированной α(n).");
        Complexity.Cost result=model.length(array.getName(),c).times(model.statement(loop.getBody(),c.copy())); c.roots.put(counter,name); model.explain(loop,result,"Продвижение по parent к корню ациклического леса, не более n переходов.");return result;
    }
    static Complexity.Cost amortized(Complexity model,ForStmt outer,Complexity.Context c,Complexity.Cost count,String counter) {
        if(!(outer.getBody() instanceof BlockStmt block)||block.findAll(WhileStmt.class).size()!=1)return null;
        WhileStmt inner=block.findAll(WhileStmt.class).get(0);
        if(!simpleBody(inner.getBody()))return null;
        for(String variable:c.types.keySet()) {
            List<MethodCallExpr> pushes=calls(block,variable,Set.of("addLast","add","push")),pops=calls(inner.getBody(),variable,Set.of("removeLast","removeFirst","remove","pop"));
            if(pushes.size()==1&&pops.size()==1&&!inner.isAncestorOf(pushes.get(0))&&unconditional(pushes.get(0),block)&&unconditional(pops.get(0),inner.getBody())&&Set.of("ArrayDeque","Deque").contains(Complexity.baseType(c.concrete.getOrDefault(variable,c.types.get(variable))))) {
                if(!calls(inner.getBody(),variable,Set.of("addLast","add","push")).isEmpty())continue;
                Complexity.Context body=c.copy(); Complexity.Cost work=model.expression(inner.getCondition(),body).plus(model.statement(inner.getBody(),body));
                for(Statement statement:block.getStatements())if(statement!=inner)work=work.plus(model.statement(statement,body));
                Complexity.Cost result=count.plus(c.sizes.getOrDefault(variable,Complexity.Cost.one())).times(work);
                model.explain(outer,result,"Амортизированный стек: одна вставка за внешний шаг, каждое значение удаляется не более одного раза."); return result;
            }
        }
        for(String variable:c.initializers.keySet()) {
            List<UnaryExpr> updates=inner.getBody().findAll(UnaryExpr.class).stream().filter(unary->{Complexity.Update update=Complexity.update(unary);return update!=null&&update.variable().equals(variable)&&update.increasing()&&!update.logarithmic();}).toList();
            boolean cap=inner.getCondition().findAll(BinaryExpr.class).stream().anyMatch(test->test.getOperator()==BinaryExpr.Operator.LESS_EQUALS&&test.getLeft().toString().equals(variable)&&test.getRight().toString().equals(counter));
            if(!cap||updates.size()!=1||!unconditional(updates.get(0),inner.getBody())||!Long.valueOf(0).equals(Complexity.integer(c.initializers.get(variable))))continue;
            if(block.findAll(AssignExpr.class).stream().anyMatch(write->write.getTarget().toString().equals(variable)))continue;
            Complexity.Context body=c.copy(); body.sizes.put(variable,count);
            Complexity.Cost work=model.expression(inner.getCondition(),body).plus(model.statement(inner.getBody(),body));
            for(Statement statement:block.getStatements())if(statement!=inner)work=work.plus(model.statement(statement,body));
            Complexity.Cost result=count.times(work); model.explain(outer,result,"Общий левый указатель не сбрасывается и ограничен правым: суммарно O(n) продвижений.");return result;
        }
        return null;
    }
    static Complexity.Cost worklist(Complexity model,WhileStmt loop,Complexity.Context c) {
        List<MethodCallExpr> empty=loop.getCondition().findAll(MethodCallExpr.class).stream().filter(call->call.getNameAsString().equals("isEmpty")&&call.getScope().isPresent()).toList();
        if(empty.size()!=1||!(loop.getBody() instanceof BlockStmt block))return null;
        if(!(loop.getCondition() instanceof UnaryExpr not)||not.getOperator()!=UnaryExpr.Operator.LOGICAL_COMPLEMENT||!same(Complexity.unwrap(not.getExpression()),empty.get(0)))return null;
        String queue=empty.get(0).getScope().get().toString(); String type=Complexity.baseType(c.concrete.getOrDefault(queue,c.types.getOrDefault(queue,"")));
        if(!Set.of("ArrayDeque","Deque","PriorityQueue","Queue").contains(type))return null;
        List<ForEachStmt> scans=block.getStatements().stream().filter(statement->statement instanceof ForEachStmt).map(statement->(ForEachStmt)statement).toList();
        if(scans.size()!=1)return null;
        ForEachStmt scan=scans.get(0); String adjacency=scan.getIterable() instanceof MethodCallExpr get&&Set.of("get","getOrDefault").contains(get.getNameAsString())&&get.getScope().isPresent()?get.getScope().get().toString():"";
        List<MethodCallExpr> adds=calls(scan.getBody(),queue,Set.of("add","offer","addLast"));
        if(adds.size()!=1)return null;
        if(calls(block,queue,Set.of("add","offer","addLast")).size()!=1)return null;
        List<MethodCallExpr> removes=calls(block,queue,Set.of("remove","poll","removeFirst","pollFirst"));
        if(removes.size()!=1||!unconditional(removes.get(0),block))return null;
        MethodCallExpr enqueue=adds.get(0); IfStmt guard=enqueue.findAncestor(IfStmt.class).orElse(null);
        if(guard==null)return null;
        boolean bounded=false,priority=type.equals("PriorityQueue"); String state="";
        if(!priority) {
            for(AssignExpr write:guard.getThenStmt().findAll(AssignExpr.class)) if(write.getTarget() instanceof ArrayAccessExpr array&&write.getValue().isBooleanLiteralExpr()&&write.getValue().asBooleanLiteralExpr().getValue()) {
                if(requiresUnseen(guard.getCondition(),array)&&unconditional(write,guard.getThenStmt())&&write.getBegin().orElseThrow().isBefore(enqueue.getBegin().orElseThrow())&&guard.getThenStmt().isAncestorOf(enqueue)&&enqueue.getArguments().size()==1&&same(enqueue.getArgument(0),array.getIndex())) { bounded=true; state=array.getName().toString(); }
            }
        } else if(guard.getCondition() instanceof BinaryExpr comparison&&comparison.getOperator()==BinaryExpr.Operator.LESS&&comparison.getRight() instanceof ArrayAccessExpr array) {
            String candidate=comparison.getLeft().toString();
            boolean writes=guard.getThenStmt().isAncestorOf(enqueue)&&guard.getThenStmt().findAll(AssignExpr.class).stream().anyMatch(write->unconditional(write,guard.getThenStmt())&&write.getBegin().orElseThrow().isBefore(enqueue.getBegin().orElseThrow())&&same(write.getTarget(),array)&&write.getValue().toString().equals(candidate));
            boolean stale=block.findAll(IfStmt.class).stream().anyMatch(branch->branch.getCondition() instanceof BinaryExpr comparison2&&comparison2.getOperator()==BinaryExpr.Operator.NOT_EQUALS&&comparison2.findAll(ArrayAccessExpr.class).stream().anyMatch(access->access.getName().toString().equals(array.getName().toString()))&&!branch.getThenStmt().findAll(ContinueStmt.class).isEmpty());
            bounded=writes&&stale; state=array.getName().toString();
            if(!(enqueue.getArgument(0) instanceof ObjectCreationExpr entry)||!(model.symbols.type(entry.getType().asString()) instanceof RecordDeclaration record))return null;
            int distanceAt=-1; for(int i=0;i<entry.getArguments().size();i++)if(entry.getArgument(i).toString().equals(candidate))distanceAt=i;
            if(distanceAt<0||distanceAt>=record.getParameters().size())return null;
            String distance=record.getParameter(distanceAt).getNameAsString();
            Expression initializer=c.initializers.get(queue);
            if(initializer==null||initializer.findAll(MethodCallExpr.class).stream().anyMatch(call->call.getNameAsString().equals("reversed")))return null;
            boolean ordered=initializer.findAll(MethodCallExpr.class).stream().anyMatch(call->Set.of("comparingLong","comparingInt","comparingDouble").contains(call.getNameAsString())&&call.getArguments().size()==1&&call.getArgument(0) instanceof MethodReferenceExpr reference&&reference.getIdentifier().equals(distance)&&reference.getScope().toString().equals(record.getNameAsString()));
            if(!ordered)return null;
        }
        if(!bounded&&guard.getCondition() instanceof BinaryExpr condition&&condition.getOperator()==BinaryExpr.Operator.EQUALS&&Long.valueOf(0).equals(Complexity.integer(condition.getRight()))&&condition.getLeft() instanceof NameExpr remaining) {
            List<VariableDeclarator> counts=scan.getBody().findAll(VariableDeclarator.class).stream().filter(variable->variable.getNameAsString().equals(remaining.getNameAsString())&&variable.getInitializer().orElse(null) instanceof MethodCallExpr compute&&compute.getNameAsString().equals("compute")&&compute.getScope().isPresent()&&compute.getArguments().size()==2&&compute.getArgument(1) instanceof LambdaExpr lambda&&lambda.getParameters().size()==2&&lambda.getBody() instanceof ExpressionStmt expression&&expression.getExpression() instanceof BinaryExpr decrement&&decrement.getOperator()==BinaryExpr.Operator.MINUS&&decrement.getLeft().toString().equals(lambda.getParameter(1).getNameAsString())&&Long.valueOf(1).equals(Complexity.integer(decrement.getRight()))).toList();
            if(counts.size()==1) {
                MethodCallExpr compute=(MethodCallExpr)counts.get(0).getInitializer().orElseThrow(); state=compute.getScope().get().toString();
                boolean noReset=calls(block,state,Set.of("put","clear","putAll","replace","merge")).isEmpty()&&enqueue.getArguments().size()==1&&same(enqueue.getArgument(0),compute.getArgument(0));
                bounded=noReset; priority=false;
                model.assumptions.add("Топологический обход: исходная очередь содержит уникальные вершины; неотрицательные in-degree соответствуют спискам рёбер и не переполняются; переход к нулю происходит однократно.");
            }
        }
        if(!bounded||adjacency.isEmpty())return null;
        String stateArray=state;
        if(block.findAll(AssignExpr.class).stream().anyMatch(write->write.getTarget() instanceof ArrayAccessExpr array&&array.getName().toString().equals(stateArray)&&(!guard.getThenStmt().isAncestorOf(write)||write.getValue() instanceof BooleanLiteralExpr value&&!value.getValue())))return null;
        if(block.findAll(MethodCallExpr.class).stream().anyMatch(call->call.getArguments().stream().anyMatch(argument->argument.toString().equals(stateArray))))return null;
        Complexity.Cost vertices=c.sizes.getOrDefault(state,Complexity.Cost.variable("V("+adjacency+")")),edges=Complexity.Cost.variable("E("+adjacency+")");
        Complexity.Cost initial=c.sizes.getOrDefault(queue,Complexity.Cost.variable("|"+queue+"|"));
        Complexity.Context body=c.copy(); body.sizes.put(queue,vertices.plus(edges).plus(initial));
        Complexity.Cost perVertex=Complexity.Cost.one();
        for(Statement statement:block.getStatements())if(statement!=scan)perVertex=perVertex.plus(model.statement(statement,body));
        for(VariableDeclarator variable:scan.getVariable().getVariables())body.types.put(variable.getNameAsString(),variable.getType().asString());
        Complexity.Cost perEdge=model.expression(scan.getIterable(),body).plus(model.statement(scan.getBody(),body));
        // Caller-supplied worklists may already contain duplicates. Priority queues
        // can additionally extract O(E) stale entries before the guard continues.
        Complexity.Cost removals=vertices.plus(initial).plus(priority?edges:Complexity.Cost.one());
        Complexity.Cost edgeVisits=edges.times(initial);
        Complexity.Cost result=removals.times(perVertex).plus(edgeVisits.times(perEdge));
        if(priority) {
            model.assumptions.add("Для Дейкстры веса неотрицательны и сложение расстояний не переполняется; stale-guard и строгое улучшение ограничивают повторные извлечения числом рёбер.");
            for(AssignExpr write:guard.getThenStmt().findAll(AssignExpr.class))if(write.getTarget() instanceof ArrayAccessExpr array&&!array.getName().toString().equals(state))c.chains.put(array.getName().toString(),vertices);
        }
        model.explain(loop,result,priority?"Приоритетная очередь с отбрасыванием устаревших расстояний; V — вершины, E — рёбра.":"Очередь обхода: вершина помечается до вставки, каждая помечается однократно; сумма сканирований равна E.");
        return result;
    }
}

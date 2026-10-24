import com.github.javaparser.*;
import com.github.javaparser.ast.*;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.type.*;
import java.util.*;
import java.util.stream.Collectors;

/** Method declarations and owner metadata; never executes submitted code. */
final class Methods {
    static boolean accepts(Node n) {
        return n instanceof ClassOrInterfaceDeclaration || n instanceof EnumDeclaration || n instanceof RecordDeclaration;
    }
    static String name(TypeDeclaration<?> type) {
        List<String> names = new ArrayList<>();
        Node n = type;
        while (n != null) {
            if (n instanceof TypeDeclaration<?> t) names.add(0, t.getNameAsString());
            n = n.getParentNode().orElse(null);
        }
        return String.join(".", names);
    }
    static Map<String,Object> container(TypeDeclaration<?> type, String file) {
        String kind = type instanceof ClassOrInterfaceDeclaration c ? c.isInterface() ? "interface" : "class" : type instanceof EnumDeclaration ? "enum" : type instanceof RecordDeclaration ? "record" : "annotation";
        return Engine.obj("id", type.getData(Engine.ID), "name", name(type), "file", file, "kind", kind,
            "canAddMethods", accepts(type), "isAbstract", type instanceof ClassOrInterfaceDeclaration c && (c.isInterface() || c.isAbstract()),
            "methodNames", type.getMethods().stream().map(MethodDeclaration::getNameAsString).toList());
    }
    static Map<String,Object> metadata(MethodDeclaration method) {
        MethodDeclaration header = method.clone();
        header.removeBody(); header.removeComment();
        String signature = header.toString().strip();
        if (signature.endsWith(";")) signature = signature.substring(0, signature.length()-1).strip();
        String body = method.getBody().map(Object::toString).orElse("");
        if (body.startsWith("{")) body = body.substring(1, body.lastIndexOf('}')).strip();
        return Engine.obj("signature", signature, "body", body, "hasBody", method.getBody().isPresent());
    }
    static MethodDeclaration parse(String code, TypeDeclaration<?> target) {
        String kind = target instanceof ClassOrInterfaceDeclaration c && c.isInterface() ? "interface" : "class";
        CompilationUnit unit = Engine.required(new JavaParser(Engine.CONFIG).parse(kind+" __MethodInput__ {\n"+code+"\n}"));
        if (unit.getTypes().size()!=1 || !(unit.getType(0) instanceof ClassOrInterfaceDeclaration owner)
            || !owner.getNameAsString().equals("__MethodInput__") || owner.getMembers().size()!=1
            || !(owner.getMember(0) instanceof MethodDeclaration)) {
            throw new IllegalArgumentException("Введите ровно один метод: сигнатуру и тело. Поля, конструкторы и дополнительные классы здесь не допускаются.");
        }
        return ((MethodDeclaration)unit.getType(0).getMember(0)).clone();
    }
    static void validate(TypeDeclaration<?> owner, MethodDeclaration method, MethodDeclaration replacing) {
        if (!accepts(owner)) throw new IllegalArgumentException("В этот тип нельзя добавить обычный метод.");
        boolean iface = owner instanceof ClassOrInterfaceDeclaration c && c.isInterface();
        Set<Modifier.Keyword> modifiers = new HashSet<>();
        int visibility=0;
        for (Modifier modifier : method.getModifiers()) {
            Modifier.Keyword keyword=modifier.getKeyword();
            if (!Set.of(Modifier.Keyword.PUBLIC, Modifier.Keyword.PRIVATE, Modifier.Keyword.PROTECTED, Modifier.Keyword.ABSTRACT, Modifier.Keyword.STATIC, Modifier.Keyword.FINAL, Modifier.Keyword.SYNCHRONIZED, Modifier.Keyword.NATIVE, Modifier.Keyword.STRICTFP, Modifier.Keyword.DEFAULT).contains(keyword)) throw new IllegalArgumentException("Недопустимый модификатор метода: "+keyword.asString());
            if (!modifiers.add(keyword)) throw new IllegalArgumentException("Модификатор "+keyword.asString()+" указан несколько раз.");
            if (Set.of(Modifier.Keyword.PUBLIC, Modifier.Keyword.PRIVATE, Modifier.Keyword.PROTECTED).contains(keyword)) visibility++;
        }
        if (visibility>1) throw new IllegalArgumentException("Укажите только один модификатор доступа.");
        if (method.isAbstract() && (method.isStatic() || method.isPrivate() || method.isFinal() || method.isNative() || method.isSynchronized() || method.isStrictfp())) {
            throw new IllegalArgumentException("Недопустимое сочетание модификаторов abstract-метода.");
        }
        if (method.getBody().isPresent() && (method.isAbstract() || method.isNative())) throw new IllegalArgumentException("abstract/native-метод не должен иметь тела.");
        if (!iface && method.isDefault()) throw new IllegalArgumentException("Модификатор default допускается только в интерфейсе.");
        if (iface) {
            if (method.isProtected() || method.isFinal() || method.isNative() || method.isSynchronized()) throw new IllegalArgumentException("Недопустимый модификатор метода интерфейса.");
            if (method.isDefault() && (method.isStatic() || method.isPrivate() || method.isAbstract())) throw new IllegalArgumentException("default нельзя сочетать со static, private или abstract.");
            boolean concrete=method.isDefault() || method.isStatic() || method.isPrivate();
            if (method.getBody().isPresent() != concrete) throw new IllegalArgumentException(concrete
                ? "Методу default/static/private в интерфейсе нужно тело."
                : "Для метода с телом в интерфейсе укажите default, static или private.");
        } else if (method.getBody().isEmpty()) {
            if (!method.isAbstract() && !method.isNative()) throw new IllegalArgumentException("Методу класса нужно тело или модификатор abstract/native.");
            if (method.isAbstract() && !(owner instanceof ClassOrInterfaceDeclaration c && c.isAbstract()) && !(owner instanceof EnumDeclaration)) throw new IllegalArgumentException("abstract-метод можно объявить только в абстрактном классе или enum.");
        }
        Set<String> parameterNames=new HashSet<>();
        for (int i=0;i<method.getParameters().size();i++) {
            Parameter parameter=method.getParameter(i);
            if (!parameterNames.add(parameter.getNameAsString())) throw new IllegalArgumentException("Параметр "+parameter.getNameAsString()+" указан несколько раз.");
            if (parameter.isVarArgs() && i!=method.getParameters().size()-1) throw new IllegalArgumentException("Varargs-параметр должен быть последним.");
        }
        String signature=signature(method,owner);
        for (MethodDeclaration existing : owner.getMethods()) {
            if (existing!=replacing && signature(existing,owner).equals(signature)) throw new IllegalArgumentException("Метод с такой сигнатурой уже существует: "+signature+". Изменение только типа результата не создаёт перегрузку.");
        }
        if (owner instanceof EnumDeclaration && (signature.equals("values()") || signature.equals("valueOf(java.lang.String)"))) throw new IllegalArgumentException("Этот метод автоматически создаётся для enum: "+signature);
    }
    static Map<String,Type> typeVariables(MethodDeclaration method, TypeDeclaration<?> owner) {
        Map<String,Type> variables=new HashMap<>();
        Node current=owner;
        while (current!=null) {
            if (current instanceof ClassOrInterfaceDeclaration c) for (TypeParameter t:c.getTypeParameters()) variables.putIfAbsent(t.getNameAsString(),bound(t));
            if (current instanceof RecordDeclaration r) for (TypeParameter t:r.getTypeParameters()) variables.putIfAbsent(t.getNameAsString(),bound(t));
            current=current.getParentNode().orElse(null);
        }
        for (TypeParameter t:method.getTypeParameters()) variables.put(t.getNameAsString(),bound(t));
        return variables;
    }
    static Type bound(TypeParameter t) { return t.getTypeBound().isEmpty()?new ClassOrInterfaceType(null,"java.lang.Object"):t.getTypeBound().get(0); }
    static String signature(MethodDeclaration method, TypeDeclaration<?> owner) {
        Map<String,Type> variables=typeVariables(method,owner);
        return method.getNameAsString()+"("+method.getParameters().stream().map(p -> erased(p.getType(),variables,owner,new HashSet<>())+(p.isVarArgs()?"[]":"")).collect(Collectors.joining(","))+")";
    }
    static String erased(Type type, Map<String,Type> variables, TypeDeclaration<?> owner, Set<String> resolving) {
        if (type instanceof ArrayType a) return erased(a.getComponentType(),variables,owner,resolving)+"[]";
        if (!(type instanceof ClassOrInterfaceType c)) return type.asString();
        String raw=c.getNameWithScope();
        if (!raw.contains(".") && variables.containsKey(raw)) {
            if (!resolving.add(raw)) return "java.lang.Object";
            return erased(variables.get(raw),variables,owner,resolving);
        }
        if (raw.contains(".")) return raw;
        CompilationUnit unit=owner.findCompilationUnit().orElseThrow();
        String pkg=unit.getPackageDeclaration().map(p->p.getNameAsString()+".").orElse("");
        for (TypeDeclaration<?> local:unit.findAll(TypeDeclaration.class)) if (local.getNameAsString().equals(raw)) return pkg+name(local);
        for (ImportDeclaration imp:unit.getImports()) if (!imp.isStatic() && !imp.isAsterisk() && imp.getName().getIdentifier().equals(raw)) return imp.getNameAsString();
        if (Set.of("Object","String","Boolean","Byte","Short","Integer","Long","Float","Double","Character","Number","Comparable","CharSequence","Iterable","Throwable","Exception","RuntimeException","Void","Class").contains(raw)) return "java.lang."+raw;
        if (Set.of("List","Map","Set","Collection","ArrayList","LinkedList","HashMap","TreeMap","HashSet","TreeSet","Optional","Comparator","Iterator").contains(raw)
            && unit.getImports().stream().anyMatch(i->i.isAsterisk() && i.getNameAsString().equals("java.util"))) return "java.util."+raw;
        return pkg+raw;
    }
    static void fresh(Node node) { node.walk(n -> n.setData(Engine.ID,UUID.randomUUID().toString())); }
}

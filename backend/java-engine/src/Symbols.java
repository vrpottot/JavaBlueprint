import com.github.javaparser.ast.*;
import com.github.javaparser.ast.body.*;
import com.github.javaparser.ast.expr.*;
import com.github.javaparser.ast.type.*;
import java.util.*;

/** A bounded project-local symbol index; ambiguous overloads remain unresolved. */
final class Symbols {
    final List<TypeDeclaration<?>> types = new ArrayList<>();
    Symbols(List<CompilationUnit> units) { for(CompilationUnit unit:units) for(TypeDeclaration<?> type:unit.findAll(TypeDeclaration.class))types.add(type); }
    static String raw(String type) { return type.replaceAll("<.*>","").replace("java.util.","").replace("java.lang.","").replace("java.io.","").trim(); }
    static List<String> arguments(String type) {
        int start=type.indexOf('<'), end=type.lastIndexOf('>');
        if(start<0 || end<start) return List.of();
        List<String> result=new ArrayList<>(); int depth=0, part=start+1;
        for(int i=part;i<end;i++) { char ch=type.charAt(i); if(ch=='<')depth++; if(ch=='>')depth--; if(ch==','&&depth==0) { result.add(type.substring(part,i).trim()); part=i+1; } }
        result.add(type.substring(part,end).trim()); return result;
    }
    static String argument(String type,int index) { List<String> args=arguments(type); return args.size()>index?args.get(index):"Object"; }
    TypeDeclaration<?> type(String name) {
        if(name.startsWith("java."))return null;
        String raw=raw(name); List<TypeDeclaration<?>> matches=types.stream().filter(t->t.getNameAsString().equals(raw)||Methods.name(t).equals(raw)||Methods.name(t).endsWith("."+raw)).toList();
        return matches.size()==1?matches.get(0):null;
    }
    String bind(String value,TypeDeclaration<?> owner,String actual) {
        List<TypeParameter> parameters=owner instanceof ClassOrInterfaceDeclaration c?c.getTypeParameters():owner instanceof RecordDeclaration r?r.getTypeParameters():List.of();
        List<String> actuals=arguments(actual);
        for(int i=0;i<parameters.size();i++) {
            TypeParameter parameter=parameters.get(i);
            String replacement=i<actuals.size()?actuals.get(i):parameter.getTypeBound().isEmpty()?"Object":parameter.getTypeBound().get(0).asString();
            value=value.replaceAll("\\b"+java.util.regex.Pattern.quote(parameter.getNameAsString())+"\\b",java.util.regex.Matcher.quoteReplacement(replacement));
        }
        return value;
    }
    String field(String ownerType,String name) { return field(ownerType,name,new HashSet<>()); }
    String field(String ownerType,String name,Set<String> seen) {
        if(!seen.add(ownerType))return "";
        TypeDeclaration<?> owner=type(ownerType); if(owner==null)return "";
        for(FieldDeclaration field:owner.getFields()) for(VariableDeclarator variable:field.getVariables()) if(variable.getNameAsString().equals(name)) return bind(variable.getType().asString(),owner,ownerType);
        if(owner instanceof RecordDeclaration record) for(Parameter parameter:record.getParameters()) if(parameter.getNameAsString().equals(name)) return bind(parameter.getType().asString(),owner,ownerType);
        if(owner instanceof ClassOrInterfaceDeclaration c && !c.getExtendedTypes().isEmpty()) return field(c.getExtendedTypes().get(0).asString(),name,seen);
        return "";
    }
    MethodDeclaration method(String receiver,String name,List<String> actualTypes) { return method(receiver,name,actualTypes,new HashSet<>()); }
    MethodDeclaration method(String receiver,String name,List<String> actualTypes,Set<String> seen) {
        if(!seen.add(receiver))return null;
        TypeDeclaration<?> owner=type(receiver); if(owner==null)return null;
        List<MethodDeclaration> candidates=owner.getMethodsByName(name).stream().filter(m->m.getParameters().size()==actualTypes.size()).toList();
        if(candidates.size()==1)return candidates.get(0);
        List<MethodDeclaration> exact=candidates.stream().filter(m->{for(int i=0;i<actualTypes.size();i++) if(actualTypes.get(i).isEmpty()||!raw(bind(m.getParameter(i).getType().asString(),owner,receiver)).equals(raw(actualTypes.get(i))))return false;return true;}).toList();
        if(exact.size()==1)return exact.get(0);
        if(candidates.isEmpty()&&owner instanceof ClassOrInterfaceDeclaration c&&!c.getExtendedTypes().isEmpty()) return method(c.getExtendedTypes().get(0).asString(),name,actualTypes,seen);
        if(candidates.isEmpty()&&owner.findAncestor(TypeDeclaration.class).orElse(null) instanceof TypeDeclaration<?> outer)return method(Methods.name(outer),name,actualTypes,seen);
        return null;
    }
    static TypeDeclaration<?> owner(Node node) { return node.findAncestor(TypeDeclaration.class).orElse(null); }
    boolean subtype(TypeDeclaration<?> candidate,TypeDeclaration<?> ancestor,Set<String> seen) {
        if(candidate==ancestor)return true;
        if(!seen.add(Methods.name(candidate))||!(candidate instanceof ClassOrInterfaceDeclaration declaration))return false;
        List<ClassOrInterfaceType> bases=new ArrayList<>(declaration.getExtendedTypes()); bases.addAll(declaration.getImplementedTypes());
        for(ClassOrInterfaceType base:bases) { TypeDeclaration<?> parent=type(base.asString()); if(parent!=null&&subtype(parent,ancestor,seen))return true; }
        return false;
    }
    List<MethodDeclaration> dispatch(String receiver,MethodDeclaration target) {
        if(target.isStatic()||target.isPrivate()||target.isFinal())return List.of(target);
        TypeDeclaration<?> declared=type(receiver); if(declared==null||declared instanceof RecordDeclaration||declared instanceof EnumDeclaration||declared.getModifiers().stream().anyMatch(modifier->modifier.getKeyword()==Modifier.Keyword.FINAL))return List.of(target);
        Set<MethodDeclaration> result=Collections.newSetFromMap(new IdentityHashMap<>()); result.add(target);
        for(TypeDeclaration<?> subtype:types)if(subtype(subtype,declared,new HashSet<>()))for(MethodDeclaration method:subtype.getMethodsByName(target.getNameAsString()))if(method.getParameters().size()==target.getParameters().size())result.add(method);
        return new ArrayList<>(result);
    }
    static List<Parameter> parameters(Node node) {
        if(node instanceof CallableDeclaration<?> callable)return callable.getParameters();
        if(node instanceof CompactConstructorDeclaration && owner(node) instanceof RecordDeclaration record)return record.getParameters();
        return List.of();
    }
}

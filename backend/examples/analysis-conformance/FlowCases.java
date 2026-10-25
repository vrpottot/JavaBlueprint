import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Executable Java semantics oracle for the CFG tests; all state is local. */
public final class FlowCases {
    private FlowCases() {}

    static int snapshot(List<String> trace) {
        int value = 1;
        try {
            trace.add("try");
            return value++;
        } finally {
            value = 9;
            trace.add("finally:" + value);
        }
    }

    static int override(boolean replace, List<String> trace) {
        try {
            trace.add("try");
            return 1;
        } finally {
            trace.add("finally");
            if (replace) {
                return 2;
            }
        }
    }

    static int nested(List<String> trace) {
        try {
            try {
                trace.add("body");
                return 7;
            } finally {
                trace.add("inner");
            }
        } finally {
            trace.add("outer");
        }
    }

    static int loop(boolean again, List<String> trace) {
        int steps = 0;
        outer:
        for (int index = 0; index < 3; index++) {
            try {
                steps++;
                if (again) {
                    continue outer;
                }
                break outer;
            } finally {
                trace.add("finally:" + index);
            }
        }
        trace.add("after");
        return steps;
    }

    static final class Resource implements AutoCloseable {
        final String name;
        final List<String> trace;
        final IOException closeFailure;

        Resource(String name, List<String> trace, boolean failOpen, IOException closeFailure) throws IOException {
            this.name = name;
            this.trace = trace;
            this.closeFailure = closeFailure;
            trace.add("open:" + name);
            if (failOpen) {
                throw new IOException("open:" + name);
            }
        }

        @Override
        public void close() throws IOException {
            trace.add("close:" + name);
            if (closeFailure != null) {
                throw closeFailure;
            }
        }
    }

    static String resources(int failOpen, boolean bodyFailure, boolean closeFailures, List<String> trace) {
        try (Resource first = new Resource("first", trace, failOpen == 1,
                     closeFailures ? new IOException("close:first") : null);
             Resource second = new Resource("second", trace, failOpen == 2,
                     closeFailures ? new IOException("close:second") : null)) {
            trace.add("body:" + first.name + "+" + second.name);
            if (bodyFailure) {
                throw new IOException("body");
            }
            return "ok";
        } catch (IOException failure) {
            trace.add("catch:" + failure.getMessage());
            for (Throwable suppressed : failure.getSuppressed()) {
                trace.add("suppressed:" + suppressed.getMessage());
            }
            return failure.getMessage();
        } finally {
            trace.add("finally");
        }
    }

    static int closeOverridesReturn(List<String> trace) {
        try (Resource resource = new Resource("one", trace, false, new IOException("close"))) {
            trace.add("return:" + resource.name);
            return 1;
        } catch (IOException failure) {
            trace.add("catch:" + failure.getMessage());
            return 2;
        } finally {
            trace.add("finally");
        }
    }

    static boolean selfSuppression(List<String> trace) {
        IOException primary = new IOException("same");
        try (Resource resource = new Resource("one", trace, false, primary)) {
            trace.add("body:" + resource.name);
            throw primary;
        } catch (IllegalArgumentException failure) {
            trace.add("self-suppression");
            return true;
        } catch (IOException failure) {
            return false;
        } finally {
            trace.add("finally");
        }
    }

    static int finallyThrows(List<String> trace) throws IOException {
        try {
            trace.add("return");
            return 1;
        } finally {
            trace.add("finally");
            if (!trace.isEmpty()) {
                throw new IOException("winner");
            }
        }
    }

    static void nullResource(List<String> trace) throws IOException {
        try (Resource resource = null) {
            trace.add(resource == null ? "null" : "nonnull");
        } finally {
            trace.add("finally");
        }
    }

    public static void main(String[] args) throws IOException {
        List<String> trace = new ArrayList<>();
        System.out.println("snapshot=" + snapshot(trace) + " " + trace);
        trace.clear();
        System.out.println("override=" + override(true, trace) + " " + trace);
        trace.clear();
        System.out.println("nested=" + nested(trace) + " " + trace);
        trace.clear();
        System.out.println("continue=" + loop(true, trace) + " " + trace);
        trace.clear();
        System.out.println("primary=" + resources(0, true, true, trace) + " " + trace);
        trace.clear();
        System.out.println("initialization=" + resources(2, false, false, trace) + " " + trace);
        trace.clear();
        System.out.println("self=" + selfSuppression(trace) + " " + trace);
    }
}

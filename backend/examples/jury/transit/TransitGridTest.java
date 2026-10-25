import org.junit.jupiter.api.Test;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;

class TransitGridTest {
    TransitGrid.Network network(int count) {
        var result=new TransitGrid.Network();
        for(int i=0;i<count;i++)result.add("n"+i,i%3);
        return result;
    }

    void edge(TransitGrid.Network network,int from,int to,int minutes,int capacity) {
        network.connect(new TransitGrid.Link(network.links.size(),from,to,minutes,capacity,1));
    }

    long minimumCutOracle(int count,List<int[]> edges) {
        long best=Long.MAX_VALUE;
        for(int mask=1;mask<(1<<count);mask+=2) {
            if((mask&(1<<(count-1)))!=0)continue;
            long sum=0;
            for(int[] edge:edges)if((mask&(1<<edge[0]))!=0&&(mask&(1<<edge[1]))==0)sum+=edge[2];
            best=Math.min(best,sum);
        }
        return best;
    }

    @Test void dinicMatchesExhaustiveMinimumCutsOnRandomDirectedMultigraphs() {
        Random random=new Random(67);
        for(int round=0;round<35;round++) {
            int count=2+random.nextInt(6);
            List<int[]> edges=new ArrayList<>();
            var flow=new TransitGrid.Flow(count);
            for(int i=0;i<count*3;i++) {
                int from=random.nextInt(count),to=(from+1+random.nextInt(count-1))%count,capacity=random.nextInt(12);
                edges.add(new int[]{from,to,capacity});flow.add(from,to,capacity);
            }
            long maximum=flow.maximum(0,count-1);
            assertEquals(minimumCutOracle(count,edges),maximum);
            assertEquals(maximum,flow.cutCapacity(flow.reachable(0)));
            assertEquals(0,flow.maximum(0,count-1));
        }
    }

    @Test void maximumFlowHandlesParallelEdgesAndTrivialSink() {
        var flow=new TransitGrid.Flow(3);
        flow.add(0,1,3);flow.add(0,1,4);flow.add(1,2,20);flow.add(1,0,1);
        assertEquals(7,flow.maximum(0,2));
        assertEquals(0,flow.maximum(1,1));
        assertThrows(IllegalArgumentException.class,()->flow.add(0,0,1));
        assertThrows(IllegalArgumentException.class,()->flow.add(0,1,-1));
    }

    @Test void shortestPathsMatchIndependentBellmanFordOracle() {
        Random random=new Random(11);
        for(int round=0;round<12;round++) {
            var graph=network(8);
            for(int i=0;i<30;i++) {
                int from=random.nextInt(8),to=random.nextInt(8);
                if(from!=to)edge(graph,from,to,1+random.nextInt(15),3);
            }
            var router=new TransitGrid.Router(graph);
            var floyd=router.floyd();
            for(int source=0;source<8;source++) {
                long[] expected=new long[8];Arrays.fill(expected,TransitGrid.INF);expected[source]=0;
                for(int pass=0;pass<7;pass++)for(var link:graph.links.values()) {
                    if(expected[link.from]<TransitGrid.INF)expected[link.to]=Math.min(expected[link.to],expected[link.from]+link.minutes);
                }
                assertArrayEquals(expected,floyd[source]);
                for(int to=0;to<8;to++)assertEquals(expected[to],router.route(source,to,0,1,false).arrival());
            }
        }
    }

    @Test void timetableRoundingExpressDispatchAndCapacityAreRespected() {
        var graph=network(3);
        var first=new TransitGrid.Link(0,0,1,5,2,7);
        graph.connect(first);graph.connect(new TransitGrid.ExpressLink(1,1,2,3,2,2));
        assertEquals(7,first.departure(1));assertEquals(7,first.departure(7));
        var path=new TransitGrid.Router(graph).route(0,2,1,2,true);
        assertEquals(17,path.arrival());assertEquals(List.of(0,1),path.links());
        first.reserve(2);
        assertFalse(new TransitGrid.Router(graph).route(0,2,0,1,true).found());
        first.release(2);first.closed=true;
        assertFalse(new TransitGrid.Router(graph).route(0,2,0,1,true).found());
    }

    @Test void stronglyConnectedComponentsMatchMutualReachability() {
        for(int seed=0;seed<10;seed++) {
            var graph=TransitGrid.generate(12,seed);
            var groups=new TransitGrid.Components(graph).find();
            int[] component=new int[12];
            for(int i=0;i<groups.size();i++)for(int vertex:groups.get(i))component[vertex]=i;
            for(int from=0;from<12;from++)for(int to=0;to<12;to++) {
                boolean mutually=graph.reachable(from).contains(to)&&graph.reachable(to).contains(from);
                assertEquals(mutually,component[from]==component[to]);
            }
            var condensed=TransitGrid.condensation(graph);
            assertEquals(groups.size(),TransitGrid.topological(condensed).size());
        }
    }

    @Test void topologicalOrderRejectsCyclesAndKeepsDeterministicTies() {
        var graph=network(4);edge(graph,0,2,1,1);edge(graph,1,2,1,1);edge(graph,2,3,1,1);
        assertEquals(List.of(0,1,2,3),TransitGrid.topological(graph));
        edge(graph,3,0,1,1);
        assertThrows(IllegalArgumentException.class,()->TransitGrid.topological(graph));
    }

    @Test void kruskalBackboneMatchesIndependentSubsetEnumeration() {
        var graph=network(4);
        edge(graph,0,1,6,1);edge(graph,0,2,2,1);edge(graph,0,3,9,1);
        edge(graph,1,2,3,1);edge(graph,1,3,1,1);edge(graph,2,3,8,1);
        long best=Long.MAX_VALUE;
        var links=new ArrayList<>(graph.links.values());
        for(int mask=0;mask<(1<<links.size());mask++) {
            if(Integer.bitCount(mask)!=3)continue;
            boolean[][] connected=new boolean[4][4];long cost=0;
            for(int i=0;i<4;i++)connected[i][i]=true;
            for(int i=0;i<links.size();i++)if((mask&(1<<i))!=0) {
                var link=links.get(i);connected[link.from][link.to]=connected[link.to][link.from]=true;cost+=link.minutes;
            }
            for(int via=0;via<4;via++)for(int from=0;from<4;from++)for(int to=0;to<4;to++)connected[from][to]|=connected[from][via]&&connected[via][to];
            if(connected[0][1]&&connected[0][2]&&connected[0][3])best=Math.min(best,cost);
        }
        var backbone=TransitGrid.backbone(graph);
        assertEquals(best,backbone.cost());assertEquals(1,backbone.components());assertEquals(3,backbone.links().size());
    }

    @Test void fenwickRangeSumsMatchArrayOracleAfterMixedUpdates() {
        var fenwick=new TransitGrid.Fenwick(30);long[] oracle=new long[30];Random random=new Random(9);
        for(int step=0;step<200;step++) {
            int at=random.nextInt(30),delta=random.nextInt(41)-20;oracle[at]+=delta;fenwick.add(at,delta);
            int a=random.nextInt(31),b=random.nextInt(31),left=Math.min(a,b),right=Math.max(a,b);long expected=0;
            for(int i=left;i<right;i++)expected+=oracle[i];
            assertEquals(expected,fenwick.range(left,right));
        }
        assertThrows(IllegalArgumentException.class,()->fenwick.add(-1,1));
        assertThrows(IllegalArgumentException.class,()->fenwick.range(3,2));
        assertThrows(IllegalArgumentException.class,()->fenwick.prefix(31));
    }

    @Test void halfOpenOccupancyHandlesArrivalsAtDepartureTick() {
        var intervals=List.of(new TransitGrid.Interval(0,3,2),new TransitGrid.Interval(3,5,4),new TransitGrid.Interval(2,4,1));
        assertEquals(5,TransitGrid.peak(intervals));
        assertEquals(0,TransitGrid.peak(List.of()));
        assertThrows(IllegalArgumentException.class,()->new TransitGrid.Interval(3,3,1));
        assertArrayEquals(new int[]{3,2,1},TransitGrid.apportion(6,new int[]{5,3,2}));
        assertArrayEquals(new int[]{1,1},TransitGrid.apportion(10,new int[]{1,1}));
        assertArrayEquals(new int[]{0,0},TransitGrid.apportion(3,new int[]{0,0}));
        assertThrows(IllegalArgumentException.class,()->TransitGrid.apportion(1,new int[]{-1}));
    }

    @Test void failedBookingRestoresAllReservationsAndRevenue() {
        var graph=network(3);edge(graph,0,1,2,4);edge(graph,1,2,3,4);
        var engine=new TransitGrid.BookingEngine(graph);
        var booking=new TransitGrid.Booking(1,0,2,2,TransitGrid.Rider.ADULT);
        assertFalse(engine.book(booking,0,true));
        assertEquals(TransitGrid.BookingState.REJECTED,booking.state);
        assertTrue(graph.links.values().stream().allMatch(link->link.reserved==0));
        assertEquals(0,engine.revenue);engine.check();
    }

    @Test void bookingCancellationDuplicateAndZeroDistanceAreDefined() {
        var graph=network(2);edge(graph,0,1,5,3);
        var engine=new TransitGrid.BookingEngine(graph);
        var booking=new TransitGrid.Booking(1,0,1,3,TransitGrid.Rider.STUDENT);
        assertTrue(engine.book(booking,0,false));
        assertEquals(3,graph.links.get(0).reserved);
        assertFalse(engine.book(new TransitGrid.Booking(1,0,1,1,TransitGrid.Rider.ADULT),0,false));
        assertTrue(engine.cancel(1));assertFalse(engine.cancel(1));assertFalse(engine.cancel(99));
        assertEquals(0,engine.revenue);engine.check();
        var local=new TransitGrid.Booking(2,0,0,1,TransitGrid.Rider.CHILD);
        assertTrue(engine.book(local,0,false));assertEquals(0,local.price);engine.check();
    }

    @Test void fareRoundingAndRiderDiscountsUseIntegerCents() {
        var graph=network(2);edge(graph,0,1,5,10);
        var path=new TransitGrid.Path(5,List.of(0));
        assertEquals(165,TransitGrid.fare(graph,path,TransitGrid.Rider.ADULT,1));
        assertEquals(116,TransitGrid.fare(graph,path,TransitGrid.Rider.STUDENT,1));
        assertEquals(198,TransitGrid.fare(graph,path,TransitGrid.Rider.CHILD,3));
        assertThrows(IllegalArgumentException.class,()->TransitGrid.fare(graph,new TransitGrid.Path(TransitGrid.INF,List.of()),TransitGrid.Rider.ADULT,1));
    }

    @Test void validationAndPatternDescriptionsExposeExplicitFailures() {
        var graph=network(2);
        int stations=0;
        for(var station:graph) { assertEquals(stations++,station.id()); }
        assertEquals(2,stations);
        assertThrows(IllegalArgumentException.class,()->graph.check(2));
        assertThrows(IllegalArgumentException.class,()->new TransitGrid.Link(0,0,0,1,1,1));
        edge(graph,0,1,1,1);
        assertTrue(graph.link(0).isPresent());assertTrue(graph.link(4).isEmpty());
        assertThrows(IllegalArgumentException.class,()->graph.connect(new TransitGrid.Link(0,0,1,1,1,1)));
        assertThrows(IllegalStateException.class,()->graph.links.get(0).reserve(2));
        assertThrows(IllegalStateException.class,()->graph.links.get(0).release(1));
        assertThrows(IllegalArgumentException.class,()->new TransitGrid.Router(graph).route(0,1,-1,1,true));
        assertEquals("null",TransitGrid.describe(null));assertEquals("abc",TransitGrid.describe("abc"));
        assertEquals("unreachable",TransitGrid.describe(new TransitGrid.Path(TransitGrid.INF,List.of())));
        assertEquals("path:3/1",TransitGrid.describe(new TransitGrid.Path(3,List.of(0))));
    }

    @Test void labelledSearchAndDisjointSetRemainConsistent() {
        var graph=network(3);edge(graph,0,1,1,1);edge(graph,1,2,1,1);
        assertFalse(TransitGrid.transferPlan(graph,0,2,Set.of()).isEmpty());
        assertTrue(TransitGrid.transferPlan(graph,0,2,Set.of(0,1,2)).isEmpty());
        var set=new TransitGrid.DisjointSet(5);
        assertTrue(set.merge(0,1));assertTrue(set.merge(2,3));assertTrue(set.merge(0,2));assertFalse(set.merge(1,3));
        assertEquals(set.root(0),set.root(3));assertNotEquals(set.root(0),set.root(4));
        assertEquals(2,graph.outgoing.stream().mapToInt(List::size).sum());
    }

    @Test void boundedSimulationsAndMainAreDeterministicAndUtf8() throws Exception {
        for(int count:new int[]{0,1,18,48})assertEquals(TransitGrid.run(count,13,true),TransitGrid.run(count,13,true));
        var originalIn=System.in;var originalOut=System.out;var output=new ByteArrayOutputStream();
        try(var stream=new PrintStream(output,true,StandardCharsets.UTF_8)) {
            System.setIn(new ByteArrayInputStream("4 13 1".getBytes(StandardCharsets.UTF_8)));System.setOut(stream);
            TransitGrid.main(new String[0]);
        } finally {
            System.setIn(originalIn);System.setOut(originalOut);
        }
        assertEquals(TransitGrid.run(4,13,true),output.toString(StandardCharsets.UTF_8));
        assertEquals(2166136261L,TransitGrid.checksum(""));
    }
}

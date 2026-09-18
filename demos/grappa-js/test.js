'use strict';
const assert=require('node:assert/strict');
const {Matchmaker,distances:d,reciprocal}=require('./grappa');
const {schema,people}=require('./example');
let count=0;
function test(name,fn){fn();count++;console.log('OK',name);}
const leaf={id:'x',request:'x',candidate:'x',distance:'linear'};
test('Normalized numeric identity and scale',()=>{
  assert.equal(d.boundedNumber(4,4),0);assert.equal(d.boundedNumber(0,20,{scale:20}),0.5);
  assert.equal(d.linear(0,100),1);assert.throws(()=>d.linear(-1,50));
});
test('Sets: duplicates, empty, directed containment',()=>{
  assert.equal(d.jaccard(['a','a'],['a']),0); assert.equal(d.jaccard([],[]),0);
  assert.equal(d.contains(['a'],['a','b']),0); assert.equal(d.contains(['a','b'],['a']),0.5);
});
test('Intervals: boundary, inside, outside, malformed',()=>{
  assert.equal(d.intervalPreference([2,6],6),0); assert.equal(d.intervalPreference([2,6],4),0);
  assert.equal(d.intervalPreference([2,6],16,{scale:10}),1);
  assert.throws(()=>d.intervalPreference([6,2],3));
});
test('Recursive aggregation uses local normalized weights',()=>{
  const m=new Matchmaker({id:'root',children:[{id:'group',weight:3,children:[leaf,{...leaf,id:'y',request:'y',candidate:'y'}]},
    {...leaf,id:'z',request:'z',candidate:'z',weight:1}]});
  assert.equal(m.evaluate({x:0,y:0,z:0},{x:100,y:0,z:100}).distanceBounds[0],0.625);
});
test('Missing values produce honest bounds and coverage',()=>{
  const m=new Matchmaker({id:'root',children:[leaf,{...leaf,id:'y',request:'y',candidate:'y'}]});
  const x=m.evaluate({x:0,y:0},{x:20});
  assert.deepEqual(x.distanceBounds,[0.1,0.6]);assert.deepEqual(x.scoreBounds,[0.4,0.9]);assert.equal(x.coverage,0.5);
});
test('Hard constraints: reject, unknown pending, equality accepted',()=>{
  const m=new Matchmaker({...leaf,maxDistance:0.2});
  assert.equal(m.evaluate({x:0},{x:21}).status,'rejected');
  assert.equal(m.evaluate({x:0},{}).status,'pending');
  assert.equal(m.evaluate({x:0},{x:20}).status,'eligible');
});
test('Offer, withdraw, k-neighbor, conservative range',()=>{
  const m=new Matchmaker(leaf);m.offer('b',{x:30});m.offer('a',{x:10});m.offer('unknown',{});
  assert.deepEqual(m.rank({x:0},{k:1}).map(x=>x.id),['a']);
  assert.deepEqual(m.rank({x:0},{r:0.2}).map(x=>x.id),['a']);
  assert.equal(m.withdraw('a'),true);assert.equal(m.rank({x:0},{r:0.2}).length,0);
});
test('Reciprocal asymmetry and symmetry of joint score',()=>{
  const m=new Matchmaker(schema()), A=people[0], B=people[2];
  const ab=reciprocal(m,A,m,B),ba=reciprocal(m,B,m,A);
  assert.notEqual(ab.ab.scoreBounds[0],ab.ba.scoreBounds[0]);assert.deepEqual(ab.scoreBounds,ba.scoreBounds);
  assert.equal(ab.scoreBounds[0],Math.min(ab.ab.scoreBounds[0],ab.ba.scoreBounds[0]));
});
test('Invalid weights, functions and plugin values fail explicitly',()=>{
  assert.throws(()=>new Matchmaker({...leaf,weight:0}));
  assert.throws(()=>new Matchmaker({...leaf,weight:NaN}));
  assert.throws(()=>new Matchmaker({...leaf,distance:'unknown'}));
  assert.throws(()=>new Matchmaker(leaf,{linear:()=>NaN}).evaluate({x:1},{x:2}));
});
test('Deterministic metric checks on normalized scalar grid',()=>{
  for(let a=0;a<=100;a+=10)for(let b=0;b<=100;b+=10)for(let c=0;c<=100;c+=10){
    assert.ok(d.linear(a,c)<=d.linear(a,b)+d.linear(b,c)+1e-12);
    assert.ok(d.boundedNumber(a,c)<=d.boundedNumber(a,b)+d.boundedNumber(b,c)+1e-12);
  }
});
console.log(`${count} tests passed.`);

(function(root){
  const G=typeof module!=='undefined'&&module.exports?require('./grappa.js'):root.GRAPPA;
  const traits=['apertura','organizacion','sociabilidad'];
  function schema(personalityWeight=3) {
    return {id:'total',children:[
      {id:'personalidad',weight:personalityWeight,children:traits.map(t=>({
        id:t,request:'traits.'+t,candidate:'traits.'+t,distance:'linear'}))},
      {id:'intereses',weight:2,request:'interests',candidate:'interests',distance:'jaccard'},
      {id:'ritmo',weight:2,request:'socialRange',candidate:'socialHours',distance:'intervalPreference',params:{scale:10}},
      {id:'objetivo',weight:1,request:'context',candidate:'context',distance:'exact',maxDistance:0}
    ]};
  }
  function person(id,name,values,target,interests,desiredInterests,hours,range,context='amistad') {
    return {id,name,profile:{traits:Object.fromEntries(traits.map((t,i)=>[t,values[i]])),interests,socialHours:hours,context},
      preferences:{traits:Object.fromEntries(traits.map((t,i)=>[t,target[i]])),interests:desiredInterests,socialRange:range,context}};
  }
  const people=[
    person('alex','Alex',[80,65,35],[75,60,45],['ciencia','cine','senderismo'],['ciencia','cine'],4,[2,6]),
    person('bea','Bea',[75,60,45],[80,60,40],['ciencia','cine'],['ciencia','senderismo'],5,[2,5]),
    person('cris','Cris',[82,70,30],[40,30,90],['ciencia','cine','senderismo'],['baile','viajes'],3,[10,15]),
    person('dani','Dani',[55,65,65],[80,65,35],['cine','musica'],['cine'],7,[3,8]),
    person('eli','Eli',[80,65,35],[80,65,35],['ciencia','cine'],['ciencia'],4,[2,6],'colaboracion'),
    person('fran','Fran',[75,60,null],[80,60,40],['cine'],['cine'],4,[2,5])
  ];
  function rank(selected='alex',weight=3,mode='min') {
    const A=people.find(p=>p.id===selected), engineA=new G.Matchmaker(schema(weight));
    return people.filter(B=>B.id!==A.id).map(B=>({id:B.id,name:B.name,...G.reciprocal(engineA,A,new G.Matchmaker(schema()),B,mode)}))
      .sort((a,b)=>({eligible:0,pending:1,rejected:2}[a.status]-{eligible:0,pending:1,rejected:2}[b.status])||b.scoreBounds[0]-a.scoreBounds[0]);
  }
  const api={schema,people,rank};
  if(typeof module!=='undefined'&&module.exports) {
    module.exports=api;
    if(require.main===module) console.table(rank().map(x=>({persona:x.name,estado:x.status,
      'A → B':x.ab.scoreBounds[0].toFixed(3),'B → A':x.ba.scoreBounds[0].toFixed(3),
      reciprocidad:x.scoreBounds.map(v=>v.toFixed(3)).join(' – '),cobertura:x.coverage.toFixed(3)})));
  } else root.Example=api;
})(globalThis);

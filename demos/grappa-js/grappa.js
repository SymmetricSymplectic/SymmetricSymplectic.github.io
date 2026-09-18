/* Reconstruction of the architectural core described by Daniel Veit (2003).
 * Independent implementation, not the original Siemens Java source.
 * Browser global GRAPPA; CommonJS require('./grappa.js'). No dependencies.
 */
(function(root) {
  'use strict';
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const unit = x => finite(x) && x >= 0 && x <= 1;
  const positive = x => finite(x) && x > 0;
  const missing = x => x === undefined || x === null;
  const get = (obj, path) => path.split('.').reduce((o,k) =>
    o != null && Object.prototype.hasOwnProperty.call(o,k) ? o[k] : undefined, obj);
  const interval = x => Array.isArray(x) && x.length === 2 &&
    x.every(finite) && x[0] <= x[1];
  const strings = x => Array.isArray(x) && x.every(v => typeof v === 'string');
  const distances = {
    // Theorem 4.5.19 applied to absolute distance / scale.
    boundedNumber(a,b,p={}) {
      const scale=p.scale ?? 1;
      check(finite(a) && finite(b) && positive(scale), 'Invalid numeric values or scale');
      const d=Math.abs(a-b)/scale;
      return Number.isFinite(d) ? d/(1+d) : 1;
    },
    // Normalized scalar distance on a declared bounded domain (extension).
    linear(a,b,p={}) {
      const lo=p.min ?? 0, hi=p.max ?? 100;
      check(finite(lo) && finite(hi) && hi>lo && finite(a) && finite(b)
        && a>=lo && a<=hi && b>=lo && b<=hi, 'Values outside linear domain');
      return Math.abs(a-b)/(hi-lo);
    },
    exact(a,b) {
      check(['string','boolean','number'].includes(typeof a) && typeof a===typeof b
        && (typeof a!=='number' || (finite(a)&&finite(b))), 'Invalid exact comparison');
      return a===b ? 0 : 1;
    },
    // Directed preference for a candidate scalar to fall inside an interval.
    intervalPreference(a,b,p={}) {
      const scale=p.scale ?? 20;
      check(interval(a) && finite(b) && positive(scale), 'Invalid interval preference');
      const d=Math.max(a[0]-b,0,b-a[1])/scale;
      return Math.min(1,d);
    },
    // Jaccard, not the book's minimum-link set distance.
    jaccard(a,b) {
      check(strings(a)&&strings(b), 'Jaccard expects arrays of strings');
      const A=new Set(a), B=new Set(b), union=new Set([...A,...B]);
      return union.size ? 1-[...A].filter(v=>B.has(v)).length/union.size : 0;
    },
    // Required subset coverage; candidate may have additional interests/skills.
    contains(a,b) {
      check(strings(a)&&strings(b), 'Contains expects arrays of strings');
      const A=new Set(a), B=new Set(b);
      return A.size ? 1-[...A].filter(v=>B.has(v)).length/A.size : 0;
    }
  };

  class Matchmaker {
    constructor(schema, plugins={}) {
      this.schema=structuredClone(schema);
      this.distances={...distances,...plugins};
      this.candidates=new Map();
      const ids=new Set();
      const validate=n=>{
        check(n && typeof n.id==='string' && !ids.has(n.id), 'Node IDs must be unique strings');
        ids.add(n.id);
        check(positive(n.weight ?? 1), 'Weights must be strictly positive');
        if(n.children) {
          check(Array.isArray(n.children)&&n.children.length>0, 'Empty aggregation');
          check(!n.distance && n.maxDistance===undefined, 'Put constraints on leaves');
          n.children.forEach(validate);
        } else {
          check(typeof n.request==='string' && n.request.length>0 &&
            typeof n.candidate==='string' && n.candidate.length>0, 'Expected MAP paths');
          check(typeof this.distances[n.distance]==='function','Unknown distance function');
          check(n.maxDistance===undefined || unit(n.maxDistance),'Invalid hard threshold');
        }
      };
      validate(this.schema);
    }
    offer(id, candidate) {
      check(typeof id==='string' && id.length>0 && candidate && typeof candidate==='object', 'Invalid offer');
      this.candidates.set(id,structuredClone(candidate));
    }
    withdraw(id) { return this.candidates.delete(id); }
    evaluate(request, candidate) {
      const visit=n=>{
        if(n.children) {
          const children=n.children.map(visit), W=n.children.reduce((s,c)=>s+(c.weight??1),0);
          check(Number.isFinite(W), 'Weight sum overflow');
          const sum=key=>children.reduce((s,c,i)=>s+(n.children[i].weight??1)/W*c[key],0);
          return {id:n.id,lower:sum('lower'),upper:sum('upper'),coverage:sum('coverage'),
            status:children.some(c=>c.status==='rejected')?'rejected':
              children.some(c=>c.status==='pending')?'pending':'eligible',children};
        }
        const a=get(request,n.request), b=get(candidate,n.candidate);
        if(missing(a)||missing(b)) return {id:n.id,lower:0,upper:1,coverage:0,
          status:n.maxDistance!==undefined?'pending':'eligible',reason:'missing',requestValue:a,candidateValue:b};
        const d=this.distances[n.distance](a,b,n.params??{});
        check(unit(d), `Distance ${n.id} must return a finite value in [0,1]`);
        const rejected=n.maxDistance!==undefined && d>n.maxDistance;
        return {id:n.id,lower:d,upper:d,coverage:1,status:rejected?'rejected':'eligible',
          reason:rejected?'hard constraint':'observed',requestValue:a,candidateValue:b};
      };
      const tree=visit(this.schema);
      return {status:tree.status,distanceBounds:[tree.lower,tree.upper],
        scoreBounds:[1-tree.upper,1-tree.lower],coverage:tree.coverage,tree};
    }
    rank(request,{k=this.candidates.size,r=1,minCoverage=0,includeIneligible=false}={}) {
      check(Number.isInteger(k)&&k>=0&&unit(r)&&unit(minCoverage),'Invalid query');
      const order={eligible:0,pending:1,rejected:2};
      return [...this.candidates].map(([id,c])=>({id,...this.evaluate(request,c)}))
        .filter(x=>(includeIneligible||x.status==='eligible')&&x.coverage>=minCoverage&&x.distanceBounds[1]<=r)
        .sort((a,b)=>order[a.status]-order[b.status]||b.scoreBounds[0]-a.scoreBounds[0]||a.id.localeCompare(b.id))
        .slice(0,k);
    }
  }
  function reciprocal(engineA, A, engineB, B, mode='min') {
    check(['min','geometric'].includes(mode),'Unknown reciprocal aggregation');
    const ab=engineA.evaluate(A.preferences,B.profile), ba=engineB.evaluate(B.preferences,A.profile);
    const combine=mode==='min'?Math.min:(a,b)=>Math.sqrt(a*b);
    return {status:[ab,ba].some(x=>x.status==='rejected')?'rejected':
      [ab,ba].some(x=>x.status==='pending')?'pending':'eligible',
      scoreBounds:[combine(ab.scoreBounds[0],ba.scoreBounds[0]),combine(ab.scoreBounds[1],ba.scoreBounds[1])],
      coverage:Math.min(ab.coverage,ba.coverage),ab,ba};
  }
  const api={Matchmaker,distances,reciprocal};
  if(typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.GRAPPA=api;
})(globalThis);

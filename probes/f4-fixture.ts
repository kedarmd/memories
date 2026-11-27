import type { RetrievalRecord } from "../src/retrieval-f4.ts";

// Synthetic human-labeled fixture. Expected IDs are declared here before ranking choices.
export const records: RetrievalRecord[] = [
  { id:"p1-cache",projectId:"proj-atlas",taskId:null,kind:"project-doc",lifecycle:"active",text:"Atlas cache uses bounded LRU storage with a 30 second time to live. Expired entries are evicted on lookup.",source:"docs/cache.md#policy",sourceExists:true,updatedAt:"2026-10-01T00:00:00.000Z" },
  { id:"t1-invalidate",projectId:"proj-atlas",taskId:"task-cache",kind:"decision",lifecycle:"active",text:"Cache invalidation occurs after a successful account update; failures retain the old value.",source:"checkpoints/cache-17#decision-1",sourceExists:true,updatedAt:"2026-11-01T00:00:00.000Z" },
  { id:"t1-old-ttl",projectId:"proj-atlas",taskId:"task-cache",kind:"decision",lifecycle:"superseded",text:"The old cache plan kept entries forever with no expiration.",source:"checkpoints/cache-03#decision-1",sourceExists:true,updatedAt:"2026-08-01T00:00:00.000Z" },
  { id:"t1-bad-lock",projectId:"proj-atlas",taskId:"task-cache",kind:"blocker",lifecycle:"invalidated",text:"Invalidated proposal to use a global lock for every cache read.",source:"checkpoints/cache-09#blocker-1",sourceExists:true,updatedAt:"2026-07-01T00:00:00.000Z" },
  { id:"t2-retry",projectId:"proj-atlas",taskId:"task-retry",kind:"decision",lifecycle:"active",text:"Retry queue uses capped exponential backoff and jitter for transient network failures.",source:"checkpoints/retry-02#decision-1",sourceExists:true,updatedAt:"2026-11-10T00:00:00.000Z" },
  { id:"p2-search",projectId:"proj-borealis",taskId:null,kind:"project-doc",lifecycle:"active",text:"Borealis cache uses bounded LRU storage with a 30 second time to live.",source:"docs/cache.md#policy",sourceExists:true,updatedAt:"2026-11-12T00:00:00.000Z" },
  { id:"t3-checkpoint",projectId:"proj-atlas",taskId:"task-cache",kind:"checkpoint",lifecycle:"active",text:"Checkpoint: account update cache behavior is implemented; failed writes leave cached values unchanged.",source:null,sourceExists:false,updatedAt:"2026-11-15T00:00:00.000Z" },
  { id:"t1-citation-bad",projectId:"proj-atlas",taskId:"task-cache",kind:"decision",lifecycle:"active",text:"Cache refresh happens after account updates complete successfully.",source:"missing/source#claim",sourceExists:false,updatedAt:"2026-11-16T00:00:00.000Z" },
];

export const queries = [
  { id:"direct-ttl", projectId:"proj-atlas", taskId:"task-cache", query:"cache 30 second time to live", expected:["p1-cache"] },
  { id:"direct-invalidation", projectId:"proj-atlas", taskId:"task-cache", query:"cache invalidation successful account update", expected:["t1-invalidate"] },
  { id:"paraphrase-expiry", projectId:"proj-atlas", taskId:"task-cache", query:"what duration before stored entries disappear", expected:["p1-cache"] },
  { id:"paraphrase-synonym-failure", projectId:"proj-atlas", taskId:"task-cache", query:"how many days until data expires", expected:["p1-cache"] },
  { id:"paraphrase-failure", projectId:"proj-atlas", taskId:"task-cache", query:"when an account change fails what stays unchanged", expected:["t1-invalidate","t3-checkpoint"] },
  { id:"cross-task", projectId:"proj-atlas", taskId:"task-cache", query:"network retry backoff jitter", expected:[] },
  { id:"cross-project", projectId:"proj-atlas", taskId:"task-cache", query:"Borealis cache 30 second time to live", expected:[] },
  { id:"negative", projectId:"proj-atlas", taskId:"task-cache", query:"quantum banana telescope", expected:[] },
  { id:"historical", projectId:"proj-atlas", taskId:"task-cache", query:"old cache entries forever no expiration", historical:true, expected:["t1-old-ttl"] },
  { id:"ambiguous", projectId:"proj-atlas", taskId:"task-cache", query:"cache account", expected:["p1-cache","t1-invalidate","t3-checkpoint","t1-citation-bad"] },
] as const;

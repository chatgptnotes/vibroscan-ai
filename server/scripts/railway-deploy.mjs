// Railway deploy via GraphQL API. Run: node scripts/railway-deploy.mjs
import dotenv from 'dotenv';
import { writeFileSync } from 'node:fs';
dotenv.config();

const TOKEN = '10b832a4-fe76-4194-8d8f-07698ebc9078';
const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const API = 'https://backboard.railway.app/graphql/v2';

async function gql(query, variables = {}) {
  const res = await fetch(API, { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
  const data = await res.json();
  if (data.errors) throw new Error('GraphQL: ' + data.errors.map((e) => e.message).join('; '));
  return data.data;
}

// ── Step 1: reuse or create project ──────────────────────────────────
console.log('=== Step 1: find or create project ===');
const existingProjects = await gql('{ projects { edges { node { id name } } } }');
const existing = existingProjects.projects.edges.find((e) => e.node.name === 'vibroscan-ai');
let projectId;
if (existing) {
  projectId = existing.node.id;
  console.log('Found existing project:', projectId);
} else {
  const projData = await gql(
    `mutation($input:ProjectCreateInput!){ projectCreate(input:$input){ id name } }`,
    { input: { name: 'vibroscan-ai', defaultEnvironmentName: 'production' } }
  );
  projectId = projData.projectCreate.id;
  console.log('Project created:', projectId);
}

// ── Step 2: get environment + service IDs ────────────────────────────
console.log('\n=== Step 2: discover environment + service ===');
const proj = await gql(
  `query($id:String!){ project(id:$id){ environments { edges { node { id name } } } services { edges { node { id name } } } } }`,
  { id: projectId }
);
const envId = proj.project.environments.edges[0].node.id;
const services = proj.project.services?.edges || [];
console.log('Environment:', envId);
console.log('Services:', services.length);
services.forEach((s) => console.log('  -', s.node.name, s.node.id));

let serviceId;
if (services.length > 0) {
  serviceId = services[0].node.id;
} else {
  console.log('\nCreating service manually...');
  const svc = await gql(
    `mutation($input:ServiceCreateInput!){ serviceCreate(input:$input){ id name } }`,
    { input: { projectId, environmentId: envId, name: 'backend', branch: 'main', source: { repo: 'chatgptnotes/vibroscan-ai' } } }
  );
  serviceId = svc.serviceCreate.id;
  console.log('Service created:', serviceId);
}

// ── Step 3: configure rootDirectory + healthcheck ────────────────────
console.log('\n=== Step 3: configure service instance ===');
try {
  await gql(
    `mutation($input:ServiceInstanceUpdateInput!,$environmentId:String!,$serviceId:String!){ serviceInstanceUpdate(input:$input,environmentId:$environmentId,serviceId:$serviceId) }`,
    { input: { rootDirectory: 'server', healthcheckPath: '/health', region: 'us-west2' }, environmentId: envId, serviceId }
  );
  console.log('Configured: rootDir=server, healthcheck=/health');
} catch (e) { console.log('Config error:', e.message.slice(0, 200)); }

// ── Step 4: set environment variables ────────────────────────────────
console.log('\n=== Step 4: set environment variables ===');
const envVars = {
  GLM_API_KEY: process.env.GLM_API_KEY || '',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  GLM_MODEL: 'glm-4.6',
  GLM_BASE_URL: 'https://api.z.ai/api/coding/paas/v4',
  GLM_MAX_TOKENS: '16000',
  VISION_PROVIDER: 'glm-mcp',
  DIAGNOSTIC_PROVIDER: 'glm',
  MCP_TIMEOUT_MS: '180000',
  REQUEST_TIMEOUT_MS: '120000',
  NODE_ENV: 'production',
  PORT: '3001',
};
try {
  await gql(
    `mutation($input:VariableCollectionUpsertInput!){ variableCollectionUpsert(input:$input) }`,
    { input: { projectId, environmentId: envId, serviceId, variables: envVars } }
  );
  console.log('Set', Object.keys(envVars).length, 'env vars');
} catch (e) { console.log('Env vars error:', e.message.slice(0, 250)); }

// ── Step 5: trigger deploy ───────────────────────────────────────────
console.log('\n=== Step 5: trigger deploy ===');
try {
  await gql(
    `mutation($input:EnvironmentTriggersDeployInput!){ environmentTriggersDeploy(input:$input) }`,
    { input: { projectId, environmentId: envId, serviceId } }
  );
  console.log('Deploy triggered');
} catch (e) { console.log('Deploy error:', e.message.slice(0, 250)); }

// ── Step 6: save IDs + get domain ────────────────────────────────────
writeFileSync('railway-project-id.txt', projectId);
writeFileSync('railway-service-id.txt', serviceId);
writeFileSync('railway-env-id.txt', envId);
console.log('\n✓ Project:', projectId, '| Service:', serviceId);
console.log('Dashboard: https://railway.com/project/' + projectId);

import axios from 'axios';

// node --env-file=.env --import tsx/esm scratch/get_openapi.ts

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function getSpec() {
  try {
    const res = await axios.get(`${url}/rest/v1/`, {
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    
    const tables = res.data.definitions;
    if (!tables) {
        console.log('Não foi possível carregar as definições. Verifique se o URL está correto.');
        return;
    }

    ['visits', 'engagement_actions', 'settings', 'campaign_configs'].forEach(t => {
      console.log(`\n--- Tabela: ${t} ---`);
      if (tables[t]) {
        console.log(Object.keys(tables[t].properties).join(', '));
      } else {
        console.log('Tabela não encontrada no schema!');
      }
    });
  } catch (e) {
    console.error('Erro ao buscar OpenAPI:', e.response?.data || e.message);
  }
}

getSpec();

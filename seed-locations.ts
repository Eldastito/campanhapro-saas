import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as xlsxModule from 'xlsx';
import * as path from 'path';

dotenv.config();

const xlsx = xlsxModule.default || xlsxModule;

// Configuração do Supabase (Usando a Role de Serviço para poder inserir livremente)
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("ERRO: VITE_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios no .env");
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

// E-mail do seu usuário administrador (usado para pegar a campaignId)
const ADMIN_EMAIL = 'examepad@gmail.com'; 
const FILE_NAME = 'municipios_bairros_rj_consolidado.xlsx';

async function seedLocations() {
  console.log('🔄 Iniciando processo de importação...');

  // 1. Descobrir o campaignId do admin
  const { data: userData, error: userError } = await supabaseAdmin
    .from('users')
    .select('campaignId')
    .eq('email', ADMIN_EMAIL)
    .single();

  if (userError || !userData?.campaignId) {
    console.error(`❌ Erro: Não foi possível encontrar a campaignId para o usuário ${ADMIN_EMAIL}.`);
    process.exit(1);
  }

  const campaignId = userData.campaignId;
  console.log(`✅ Campaign ID encontrada: ${campaignId}`);

  // 2. Ler o arquivo Excel
  const filePath = path.resolve(process.cwd(), FILE_NAME);
  console.log(`📂 Lendo o arquivo: ${filePath}`);
  
  let workbook;
  try {
    workbook = xlsx.readFile(filePath);
  } catch (err: any) {
    console.error(`❌ Erro ao ler o arquivo Excel: ${err.message}`);
    process.exit(1);
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  // Converter para array de arrays para podermos pular o cabeçalho gigante
  const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
  console.log(`📊 Encontradas ${rawData.length} linhas no Excel.`);

  if (rawData.length === 0) {
    console.log('O arquivo está vazio.');
    process.exit(0);
  }

  // Encontrar qual linha é o cabeçalho real (aquela que tem as palavras municipio e bairro em colunas diferentes)
  let headerRowIndex = 0;
  let colMunicipio = -1;
  let colBairro = -1;

  for (let i = 0; i < Math.min(20, rawData.length); i++) {
    const row = rawData[i];
    if (!row) continue;
    
    let tempColMunic = -1;
    let tempColBairro = -1;

    for (let j = 0; j < row.length; j++) {
      const cellValue = String(row[j] || '').toLowerCase();
      // Regex ou includes para pegar as colunas certas sem confundir com a primeira linha
      if (cellValue === 'município' || cellValue === 'municipio') tempColMunic = j;
      if (cellValue.includes('bairro /') || cellValue === 'bairro') tempColBairro = j;
    }

    if (tempColMunic !== -1 && tempColBairro !== -1 && tempColMunic !== tempColBairro) {
      colMunicipio = tempColMunic;
      colBairro = tempColBairro;
      headerRowIndex = i;
      break;
    }
  }

  // Se a detecção falhar, usamos os índices padrão que vimos no debug (Linha 4 -> Index 3)
  if (colMunicipio === -1 || colBairro === -1) {
      console.warn("⚠️ Usando índices de coluna fixos baseados no formato conhecido...");
      colMunicipio = 2; // "Município"
      colBairro = 3;    // "Bairro / Unidade territorial"
      headerRowIndex = 3; // Linha 4
  } else {
      console.log(`🔍 Cabeçalho encontrado na linha ${headerRowIndex + 1}. Coluna Município: ${colMunicipio}, Coluna Bairro: ${colBairro}`);
  }

  console.log("=== DEBUG: PRIMEIRAS 5 LINHAS DO EXCEL ===");
  for (let i = 0; i < Math.min(5, rawData.length); i++) {
      console.log(`Linha ${i + 1}:`, JSON.stringify(rawData[i]));
  }
  console.log("==========================================");

  // Extrair pares únicos de Município e Bairro a partir da linha após o cabeçalho
  const uniqueLocations = new Set<string>();
  const locationsToInsert: { campaignId: string, municipality: string, name: string }[] = [];

  for (let i = headerRowIndex + 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row) continue;

    const municipio = String(row[colMunicipio] || '').trim();
    const bairro = String(row[colBairro] || '').trim();

    if (municipio && bairro && municipio !== 'undefined' && bairro !== 'undefined') {
      const key = `${municipio}___${bairro}`;
      if (!uniqueLocations.has(key)) {
        uniqueLocations.add(key);
        locationsToInsert.push({
          campaignId: campaignId,
          municipality: municipio,
          name: bairro
        });
      }
    }
  }

  console.log(`🚀 Preparando para inserir ${locationsToInsert.length} bairros/municípios únicos no banco...`);
  if (locationsToInsert.length < 10) {
      console.log("⚠️ ATENÇÃO: Muito poucos bairros encontrados. Verifique o console de debug acima.");
  }

  console.log(`🚀 Preparando para inserir ${locationsToInsert.length} bairros/municípios únicos no banco...`);

  // Inserir em lotes de 500 para não estourar limite da API
  const batchSize = 500;
  let insertedCount = 0;

  for (let i = 0; i < locationsToInsert.length; i += batchSize) {
    const batch = locationsToInsert.slice(i, i + batchSize);
    
    const { error } = await supabaseAdmin
      .from('locations')
      .upsert(batch, { onConflict: 'id', ignoreDuplicates: true }); // Evitar duplicação se rodar 2x

    if (error) {
      console.error(`❌ Erro ao inserir lote ${i}:`, error.message);
    } else {
      insertedCount += batch.length;
      console.log(`⏳ Inseridos ${insertedCount} de ${locationsToInsert.length}...`);
    }
  }

  console.log('✅ Importação concluída com sucesso!');
}

seedLocations().catch(console.error);

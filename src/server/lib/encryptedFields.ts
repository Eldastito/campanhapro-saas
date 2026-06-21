/**
 * Registro ÚNICO de quais colunas são criptografadas por tabela (escopo:
 * identificadores de alto risco — CPF, RG, banco/PIX, documento do doador,
 * CPF/CNPJ do candidato). Telefone/endereço/valores ficam em texto puro de
 * propósito: são usados em busca/filtro (cifrar quebraria o CRM).
 *
 * Cada superfície (incomes, team_members, config) é ligada ao backend numa PR
 * própria; este arquivo é a fonte de verdade compartilhada por todas.
 */
export const ENCRYPTED_FIELDS = {
  incomes: ['documentoDoador'],
  team_members: ['cpf', 'rg', 'bankName', 'bankAgency', 'bankAccount', 'pixKey'],
  // campaign_configs: CPF/CNPJ do candidato — colunas confirmadas na PR da config.
} as const;

export type EncryptedTable = keyof typeof ENCRYPTED_FIELDS;

export function fieldsFor(table: EncryptedTable): readonly string[] {
  return ENCRYPTED_FIELDS[table];
}

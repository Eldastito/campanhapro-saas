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
  team_members: ['cpf', 'rg', 'voterId', 'bankName', 'bankAgency', 'bankAccount', 'pixKey'],
} as const;

/**
 * Identificadores do candidato cifrados DENTRO do JSON `settings.campaignDetails`
 * (não são colunas top-level). `identidade` = RG do candidato. dataNascimento e
 * endereço ficam fora do escopo de propósito.
 */
export const CANDIDATE_DETAIL_FIELDS = ['cpf', 'cnpj', 'identidade'] as const;

export type EncryptedTable = keyof typeof ENCRYPTED_FIELDS;

export function fieldsFor(table: EncryptedTable): readonly string[] {
  return ENCRYPTED_FIELDS[table];
}

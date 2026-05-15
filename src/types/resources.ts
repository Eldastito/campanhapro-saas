export type ResourceType =
  | 'panfleto'
  | 'camiseta'
  | 'kit_rua'
  | 'equipamento'
  | 'veiculo'
  | 'celular'
  | 'material_digital'
  | 'verba'
  | 'combustivel'
  | 'outro';

export type ResourceStatus =
  | 'available'
  | 'allocated'
  | 'in_use'
  | 'returned'
  | 'lost'
  | 'damaged'
  | 'blocked';

export interface TeamResource {
    id: string;
    campaignId: string;
    leaderId?: string | null;
    assignedMemberId?: string | null;
    resourceType: ResourceType;
    name: string;
    description?: string;
    quantity: number;
    unit?: string;
    status: ResourceStatus;
    allocatedAt?: string;
    returnedAt?: string;
    notes?: string;
    createdBy?: string;
    createdAt?: string;
    updatedAt?: string;
}

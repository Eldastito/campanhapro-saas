import * as React from 'react';
import { Visit } from '../types/visits';
import { usePermissions } from './usePermissions';
import { useVisits } from '../contexts/VisitsContext';

export const useVisitModal = () => {
    const { visits } = useVisits();
    const permissions = usePermissions();
    const [isModalOpen, setIsModalOpen] = React.useState(false);
    const [editingVisit, setEditingVisit] = React.useState<Visit | null>(null);
    
    const checkVisitLimit = React.useCallback(() => {
        if (permissions.visitLimit !== null && visits.length >= permissions.visitLimit) {
            alert(`Limite de ${permissions.visitLimit} visitas atingido para o seu plano. Faça um upgrade para adicionar mais.`);
            return false;
        }
        return true;
    }, [permissions.visitLimit, visits.length]);

    const openAddModal = React.useCallback(() => {
        if (!checkVisitLimit()) return;
        setEditingVisit(null);
        setIsModalOpen(true);
    }, [checkVisitLimit]);

    const openEditModal = React.useCallback((visit: Visit) => {
        setEditingVisit(visit);
        setIsModalOpen(true);
    }, []);
    
    const closeModal = React.useCallback(() => {
        setIsModalOpen(false);
        setEditingVisit(null);
    }, []);

    return {
        isModalOpen,
        editingVisit,
        openAddModal,
        openEditModal,
        closeModal,
        checkVisitLimit,
    };
};

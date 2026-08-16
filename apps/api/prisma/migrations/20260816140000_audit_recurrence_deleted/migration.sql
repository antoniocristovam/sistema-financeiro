-- Excluir uma conta fixa entra na trilha: em workspace compartilhado, a serie
-- que outra pessoa cadastrou desaparecer sem rastro e' exatamente o tipo de
-- mudanca que gera discussao depois.
ALTER TYPE "AuditAction" ADD VALUE 'RECURRENCE_DELETED';

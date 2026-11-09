-- Regras de triagem com os sinais da analise do PE (7.1) e de funcoes (7.2): item 7.4.
ALTER TYPE "TriageCondition" ADD VALUE 'CAPA_CAPABILITY';
ALTER TYPE "TriageCondition" ADD VALUE 'ATTACK_TECHNIQUE';
ALTER TYPE "TriageCondition" ADD VALUE 'SIGNATURE_INVALID';
ALTER TYPE "TriageCondition" ADD VALUE 'PACKED';
ALTER TYPE "TriageCondition" ADD VALUE 'PE_ALERT';
ALTER TYPE "TriageCondition" ADD VALUE 'HIDDEN_IOC';

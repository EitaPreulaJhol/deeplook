/**
 * Registra os servicos novos na fila comum (plans/novas-analises): importar este arquivo garante que
 * emulacao, APK e configuracao estao em lib/service-analysis.ts antes da fila subir e das rotas.
 */
import './emulation';
import './android';
import './config-extract';

export {
  enqueueService,
  enqueueServicesIfEligible,
  serviceDef,
  serviceEnabled,
  startServiceQueues,
} from './service-analysis';

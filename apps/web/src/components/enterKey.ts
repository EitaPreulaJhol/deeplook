/**
 * Enter que confirma um campo de uma linha (adicionar, ativar), e nao o Enter que fecha uma
 * composicao de IME (chines, japones, coreano): ali o Enter escolhe o caractere, e tratar como
 * envio manda o texto pela metade. O `isComposing` cobre Chrome, Edge e Firefox; o Safari
 * entrega o compositionend antes desse keydown (WebKit 165004), com `isComposing` ja falso, mas
 * o keydown ainda chega com keyCode 229, por isso as duas conferencias.
 */
interface EnterKeyEvent {
  key: string;
  keyCode: number;
  nativeEvent: { isComposing: boolean };
}

export function isSubmitEnter(event: EnterKeyEvent): boolean {
  if (event.key !== 'Enter') return false;
  return !event.nativeEvent.isComposing && event.keyCode !== 229;
}

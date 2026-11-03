import { type ComponentType, lazy, type LazyExoticComponent } from 'react';

/**
 * React.lazy para as páginas, que exportam por nome (item 6.10): cada página vira um pacote
 * próprio, baixado só quando a rota abre. Mantém o tipo das props da página, então um
 * `<KbArticlePage mode="x" />` errado continua sendo erro de compilação.
 *
 * Se o pacote não puder ser baixado (por exemplo, a página ficou aberta durante uma nova
 * versão e o arquivo antigo saiu do ar: o nginx responde 404), o React lança o erro até o
 * ErrorBoundary do AppShell, que oferece "Recarregar a página".
 */
export function lazyPage<M extends Record<K, ComponentType<any>>, K extends string>(
  load: () => Promise<M>,
  name: K,
): LazyExoticComponent<M[K]> {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}

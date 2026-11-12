// Ambiente minimo para os testes unitarios: o src/env.ts valida as variaveis ao ser importado,
// e varias bibliotecas puras o importam. Nenhuma conexao e aberta: os enderecos nao existem.
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://unit:unit@127.0.0.1:1/unit';
process.env.SESSION_SECRET ??= 'segredo-dos-testes-unitarios-0123456789';
process.env.PASSWORD_MAX_AGE_DAYS ??= '90';

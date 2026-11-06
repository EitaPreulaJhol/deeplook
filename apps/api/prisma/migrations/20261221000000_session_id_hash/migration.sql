-- O id da sessao passa a ser o SHA-256 do valor do cookie, como ja era nos tokens de API:
-- o banco e o backup (pg_dump) deixam de guardar segredos que abrem sessoes. O cookie de
-- quem esta logado nao muda, entao ninguem precisa entrar de novo.
UPDATE "Session" SET "id" = encode(sha256(convert_to("id", 'UTF8')), 'hex');

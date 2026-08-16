-- Deduplicacao de avisos.
--
-- A chave descreve o EVENTO (recorrencia + data, orcamento + mes + limiar), nao
-- a execucao do job. Assim uma reexecucao depois de falha esbarra no indice em
-- vez de duplicar o aviso na caixa do usuario.
--
-- Nulo e' permitido e NAO colide: no Postgres, NULL nunca e' igual a NULL num
-- indice unico. Aviso avulso (convite, exportacao pronta) simplesmente nao tem
-- chave e pode repetir.
ALTER TABLE "notifications" ADD COLUMN "dedupeKey" VARCHAR(200);

CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key" ON "notifications"("userId", "dedupeKey");

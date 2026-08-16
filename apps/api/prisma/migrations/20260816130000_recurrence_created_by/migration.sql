-- Autor da serie.
--
-- Os lancamentos materializados pelo job herdam este autor: `transactions`
-- exige `createdByUserId`, e sem um dono na serie o job nao teria o que gravar
-- ali. No workspace compartilhado, "quem cadastrou esta conta fixa" e' uma
-- pergunta que precisa de resposta -- inclusive quando quem lancou foi o robo.
--
-- Em tres passos, e nao um `ADD COLUMN NOT NULL` direto: ja existem series
-- criadas pelo seed, e a coluna obrigatoria de uma vez falharia na hora do
-- deploy. As linhas antigas herdam o DONO do workspace, que e' quem responde
-- por ele.
ALTER TABLE "recurrences" ADD COLUMN "createdByUserId" UUID;

UPDATE "recurrences" AS r
SET "createdByUserId" = (
  SELECT m."userId"
  FROM "workspace_members" AS m
  WHERE m."workspaceId" = r."workspaceId" AND m."role" = 'OWNER'
  LIMIT 1
)
WHERE r."createdByUserId" IS NULL;

-- Serie orfa de workspace sem dono nao deveria existir; se existir, o ALTER
-- abaixo falha de proposito em vez de inventar um autor.
ALTER TABLE "recurrences" ALTER COLUMN "createdByUserId" SET NOT NULL;

ALTER TABLE "recurrences"
  ADD CONSTRAINT "recurrences_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

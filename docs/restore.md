# Teste de restauração – checklist mensal

Referência: SPEC §9.2 ("teste de restauração mensal documentado") e T10. Estratégia: [`docs/backup.md`](backup.md).

**Periodicidade:** mensal (1ª semana útil) e sempre após mudança de infraestrutura ou de versão do PostgreSQL.
**Responsável:** administrador do consórcio (perfil ADMIN) + suporte técnico do fornecedor.
**Registro:** o script registra automaticamente em `backup_registro` (tipo `RESTORE_TESTE`); testes manuais são registrados em **/admin/backup → Registrar teste de restauração**.

## A. Teste automatizado (≈ 5 min)

```bash
# no host de operação, com as mesmas variáveis do backup (secret manager)
export DATABASE_URL=…            # produção (somente leitura) – usado para comparar contagens
export BACKUP_PASSPHRASE=…       # ou BACKUP_AGE_KEY=/caminho/identidade.age
export BACKUP_BUCKET=s3://licenciagov-dr/pg   # opcional: baixa o dump mais recente do bucket de DR
./scripts/backup/restore-test.sh
```

O script:
1. localiza o dump mais recente (bucket de DR ou `BACKUP_DIR`) e confere o `.sha256`;
2. cria o banco descartável `licenciagov_restore_teste` no mesmo servidor (ou use `DATABASE_URL` de um servidor de homologação);
3. descriptografa e restaura (`psql -v ON_ERROR_STOP=1`);
4. confere contagens de `organizacao, municipio, usuario, pessoa, empreendimento, processo, tramitacao, documento_oficial, anexo, log_auditoria` (restaurado ≤ produção e `usuario` > 0), a presença do trigger de imutabilidade de `tramitacao` e a tabela `_prisma_migrations`;
5. apaga o banco descartável (`RESTORE_MANTER=1` para manter) e registra `RESTORE_TESTE` com duração e contagens.

## B. Checklist completo (marcar e anexar evidências)

| # | Item | OK |
|---|---|---|
| 1 | `/admin/backup` mostra último backup com **menos de 24 h**, tamanho coerente com o mês anterior (variação < 30%) | ☐ |
| 2 | O objeto existe no bucket de DR (outra região/provedor) e o bucket tem versionamento/Object Lock ativos | ☐ |
| 3 | Dump baixado do **bucket de DR** (não do servidor de produção); `sha256sum -c` confere | ☐ |
| 4 | Descriptografia OK com a chave guardada no cofre (testa também a custódia da chave) | ☐ |
| 5 | Restauração sem erros (`ON_ERROR_STOP`) em banco/servidor isolado; tempo anotado (meta RTO ≤ 4 h) | ☐ |
| 6 | Contagens por tabela conferidas com a produção na data do dump | ☐ |
| 7 | Subir a aplicação apontando para o banco restaurado (`DATABASE_URL=…/licenciagov_restore_teste npm run start` em homologação) | ☐ |
| 8 | Login com usuário de teste; abrir um processo recente e sua linha do tempo | ☐ |
| 9 | Validar um documento oficial em `/validar/{codigo}` → **VÁLIDO**, e o hash do PDF (do bucket replicado) confere com `sha256_pdf` | ☐ |
| 10 | Abrir um anexo recente a partir do bucket replicado (arquivos) | ☐ |
| 11 | Trigger de imutabilidade: `UPDATE tramitacao …` falha no banco restaurado | ☐ |
| 12 | Descartar o ambiente restaurado (dados pessoais – LGPD) | ☐ |
| 13 | Registrar o resultado em `/admin/backup` com observação (duração, dump usado, problemas) | ☐ |

Em caso de falha: abrir chamado CRÍTICO, corrigir a causa e repetir o teste em até 5 dias úteis.

## C. Restauração real (desastre)

1. Preferir PITR/snapshot do Postgres gerenciado (camada 1) – menor perda.
2. Se a região/provedor primário estiver indisponível: criar Postgres 16 no provedor de DR, restaurar o último dump (passos 3–5 acima, sem apagar), `npx prisma migrate deploy` (deve reportar "no pending migrations").
3. Apontar `S3_BUCKET/S3_ENDPOINT` para o bucket replicado; subir app e worker; verificar `/api/health`.
4. Comunicar os municípios; registrar o incidente e o RPO/RTO efetivos.

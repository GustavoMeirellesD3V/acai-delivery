# Açaí Mais Chantilly — site de delivery

Cardápio, montagem do copo, checkout com PIX, pedidos em tempo real e painel
do lojista. HTML, CSS e JavaScript puros, com Supabase de backend.

Sem build, sem `npm install`. Os arquivos são servidos como estão.

---

## Como publicar (uma vez)

### 1. Banco no Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) — região **South America (São Paulo)**.
2. Abra **SQL Editor**, cole o conteúdo de `supabase/schema.sql` e rode.
   Isso cria as tabelas, as regras de segurança e já carrega o cardápio da loja.
3. Vá em **Authentication → Users → Add user** e crie o login da dona
   (e-mail e senha). Marque *Auto Confirm User*, senão ela precisa confirmar por e-mail.
4. Em **Settings → API**, copie a **Project URL** e a chave **anon / public**.
5. Cole as duas no arquivo `config.js`.

### 2. Site na Vercel

1. Suba a pasta para o GitHub.
2. Na [Vercel](https://vercel.com), **Add New → Project** e escolha o repositório.
3. Framework Preset: **Other**. Não precisa de build command nem output directory.
4. Deploy.

Depois é só apontar o domínio da loja em **Settings → Domains**.

### 3. Conferir

- Abra o site, monte um pedido e envie.
- Entre em `/#admin` com o login criado e veja se o pedido apareceu.
- Deixe o painel aberto em outra aba e faça um segundo pedido: ele deve
  entrar sozinho, com bipe, sem atualizar a página.
- Leia o QR do PIX com o app do banco e confira o valor.

---

## A chave `anon` no GitHub

Ela vai no código e pode ficar em repositório público — é assim que o Supabase
foi desenhado. Quem protege os dados são as políticas RLS do `schema.sql`:

| Quem | Cardápio | Pedidos |
|---|---|---|
| Visitante do site | lê | **não lê nada**; só cria pela função `criar_pedido` |
| Lojista logado | lê e escreve | lê, atualiza e apaga |

Testado: com a chave pública, ninguém consegue listar os pedidos, ler telefone
e endereço de cliente, alterar preço nem apagar registro.

A chave **`service_role`** é outra história — essa ignora todas as regras.
Nunca coloque ela no `config.js` nem no GitHub.

### Preço não vem do navegador

O checkout não manda quanto custa; manda só qual tamanho e quais complementos.
A função `criar_pedido` recalcula tudo a partir do banco. Mexer no preço pelo
console do navegador não muda o valor do pedido.

---

## Estrutura

```
index.html              loja + painel (painel abre em #admin)
config.js               ← suas chaves do Supabase
vercel.json             headers e cache
supabase/schema.sql     banco inteiro: tabelas, RLS, função e cardápio inicial
assets/css/style.css    identidade visual + CSS do cupom impresso
assets/css/admin.css    painel
assets/js/qr.js         gerador de QR Code (sem dependência externa)
assets/js/store.js      formatação, PIX copia e cola, textos do WhatsApp
assets/js/db.js         tudo que fala com o Supabase
assets/js/app.js        loja
assets/js/admin.js      painel
assets/js/router.js     carga inicial e rotas
```

Para rodar local: `npx serve .` ou a extensão Live Server do VS Code.
Precisa ser `http://`, não `file://` — o PIX usa `crypto.subtle`.

---

## Painel do lojista

`seusite.com.br/#admin`, ou o link no rodapé.

| Aba | O que faz |
|---|---|
| Pedidos | chegam ao vivo com bipe; status, métricas do dia, impressão do cupom |
| Cardápio e preços | tamanhos, valores, o que está ativo |
| Complementos | preço (0 = grátis), disponibilidade, limite por copo |
| Sabores | sabores do açaí saborizado |
| Configurações | loja aberta/fechada, taxa, bairros, chave PIX, mensagens |

Mudou o preço no painel, mudou na loja para todo mundo, na hora.

Trocar senha: "Esqueci minha senha" na tela de login, ou pelo Supabase em
**Authentication → Users**.

---

## Mensagens de WhatsApp

Não há disparo automático sem API paga. O que o site faz hoje:

1. **Cliente fecha o pedido** → o site grava no banco e abre o WhatsApp da loja
   com a mensagem completa já escrita. O cliente só aperta enviar.
2. **Lojista muda o status** → abre a conversa do cliente com o texto daquele
   status pronto.

Os textos ficam em Configurações e aceitam:
`{nome}` `{numero}` `{total}` `{pagamento}` `{endereco}` `{enderecoLoja}` `{loja}`

### Para automatizar de verdade

O caminho é a **WhatsApp Cloud API**, oficial da Meta. No fluxo desta loja sai
de graça: o cliente manda a primeira mensagem, o que abre uma janela de 24h,
e dentro dela as mensagens de status não são cobradas.

O custo real não é dinheiro — é que o número migrado sai do app normal do
WhatsApp e passa a ser atendido por uma caixa de entrada web. Decida isso com
a dona antes.

Evite Evolution API, Z-API e similares que conectam por QR Code: violam os
termos do WhatsApp e o risco é o número da loja ser banido em definitivo.

---

## Impressora térmica

O botão **Imprimir cupom** no painel gera um cupom de 80 mm formatado
(`@media print` no `style.css`) e manda pela impressora padrão do Windows.

Para imprimir sozinho a cada pedido, duas opções:

- **Chrome em modo quiosque**: abra o painel com a flag `--kiosk-printing` e
  a impressão sai sem caixa de diálogo. Simples, mas depende do painel aberto.
- **Agente local**: um script Node no PC da loja escutando o Supabase em
  realtime e mandando ESC/POS direto para a impressora. Roda como serviço,
  não depende de navegador, e habilita corte de papel e gaveta.

---

## Dados já cadastrados

Do cardápio impresso da loja:

- **Açaí:** 300 ml R$ 13 · 400 ml R$ 15 · 500 ml R$ 17 · 1 litro R$ 28
- **Cupuaçu:** 300 ml R$ 15 · 400 ml R$ 17 · 500 ml R$ 19 · 1 litro R$ 30
- **20 complementos** grátis, em Complementos e Caldas
- **8 sabores** de açaí saborizado
- WhatsApp (12) 99683-5226 · Rua Santo Antônio, 127 — Alto da Igreja

A chave PIX veio preenchida com o telefone da loja e o horário foi estimado.
**Confirme os dois com a dona antes de publicar.**

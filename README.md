# Açaí Mais Chantilly — site de delivery

Site de pedidos para uma açaiteria em Cachoeira Paulista/SP. O cliente monta o
copo, paga por PIX e o pedido chega no WhatsApp da loja já formatado. O balcão
acompanha tudo por um painel que recebe os pedidos ao vivo.

**[Ver o site →](https://acai-delivery-one.vercel.app)** · painel do lojista em `/#admin`

HTML, CSS e JavaScript puros com Supabase de backend. Sem framework, sem build,
sem `npm install`.

---

## O que ele faz

**Para o cliente**

Cardápio com os preços da loja, montagem do copo (tamanho, sabor e complementos),
carrinho, e checkout com PIX, cartão ou dinheiro. No PIX o site gera o QR Code e o
código copia e cola já com o valor do pedido. Ao finalizar, abre o WhatsApp da loja
com a mensagem pronta — itens, endereço, forma de pagamento e total.

**Para o lojista**

Painel com login, pedidos chegando em tempo real com alerta sonoro, mudança de
status que dispara a mensagem para o cliente, e impressão de cupom em 80 mm.
Cardápio, preços, complementos, sabores, bairros, taxa e horários todos editáveis
sem tocar em código.

---

## Três decisões que valem explicar

### O preço não vem do navegador

O checkout envia apenas o id do tamanho e dos complementos. Quem calcula é o
banco, buscando os valores na tabela:

```sql
select * into tam from public.tamanhos
  where id = (item->>'tamanho_id')::uuid and ativo = true;
...
preco_item := tam.preco + extras;
```

Mandar `total: 0` pela API não muda nada — o valor gravado é o que o banco
calculou. Testado enviando `preco: 0` num item de R$ 17: o pedido foi gravado
com R$ 17.

### A tabela de pedidos é invisível para a chave pública

A chave do Supabase que está no `config.js` é publishable — feita para ficar no
código. Quem protege os dados são as políticas RLS:

| | Cardápio | Pedidos |
|---|---|---|
| Visitante | lê | **não lê nada** |
| Lojista logado | lê e escreve | lê e atualiza |

Pedido novo não entra por `insert` direto: entra pela função `criar_pedido`, que
é `security definer`. Assim o visitante consegue criar o próprio pedido sem
conseguir listar os dos outros. Se a tabela fosse legível, qualquer um baixaria
telefone e endereço de toda a clientela.

### O QR Code do PIX é gerado sem dependência

`assets/js/qr.js` implementa o padrão QR do zero — Reed-Solomon, máscaras e
escolha de versão. São 12 KB e funciona offline.

A primeira versão usava uma biblioteca de CDN que não carregava. Em vez de trocar
de CDN, escrevi o gerador e validei decodificando 57 códigos de volta com OpenCV.
O teste encontrou um bug real: a fórmula das posições dos padrões de alinhamento
quebrava da versão 7 em diante — justamente a faixa onde cai o payload do PIX.

O código segue o padrão BR Code (EMV) com CRC16 validado.

---

## Segurança

Auditado contra XSS, SQL injection, acesso administrativo sem login e manipulação
de preço. O que foi verificado atacando o sistema em produção:

- **XSS** — 8 payloads em nome, endereço, observação e sabor, renderizados no
  painel, no cupom e no carrinho: nenhum elemento injetado
- **SQL injection** — PostgREST parametriza tudo; tentativas no filtro e no
  `order by` recusadas, tabelas intactas
- **Endpoints administrativos** — ler, apagar e alterar sem login: todos afetaram
  zero linhas
- **Rate limiting** — 12 pedidos por IP a cada 10 min, 6 por telefone a cada 30
- **Validação no servidor** — nome, telefone, endereço, pagamento, quantidade de
  itens e caracteres de controle
- **Cabeçalhos** — CSP com `script-src` estrito (o projeto não tem script inline
  nem `eval`), HSTS, COOP e afins

O painel tem três níveis de acesso — admin, gerente e atendente — com as regras
no banco, não na tela. Toda alteração de preço, cardápio ou pedido fica registrada
com autor, horário e valores antes/depois.

---

## Stack

| Camada | Escolha |
|---|---|
| Front | HTML, CSS e JavaScript puros |
| Banco | Supabase (PostgreSQL) com RLS |
| Autenticação | Supabase Auth |
| Tempo real | Supabase Realtime |
| Hospedagem | Vercel |

---

## Estrutura

```
index.html              loja + painel (painel em #admin)
config.js               chaves públicas do Supabase
vercel.json             cabeçalhos de segurança e cache
supabase/
  schema.sql            tabelas, RLS, função de pedido e cardápio inicial
  migration-horarios.sql    horário de funcionamento automático
  migration-seguranca.sql   perfis, auditoria, rate limiting
  migration-equipe.sql      gestão de equipe pelo painel
assets/js/
  qr.js                 gerador de QR Code
  store.js              formatação, PIX, textos do WhatsApp, horários
  db.js                 tudo que fala com o Supabase
  app.js                loja
  admin.js              painel
  router.js             carga inicial e rotas
```

---

## Rodando local

```bash
npx serve .
```

Precisa ser `http://`, não `file://` — o PIX usa `crypto.subtle`.

Para apontar para o seu próprio Supabase: crie um projeto, rode os quatro
arquivos de `supabase/` na ordem no SQL Editor, crie um usuário em
*Authentication → Users* e preencha o `config.js` com a Project URL e a chave
publishable.

---

## Limitações conhecidas

**As mensagens de WhatsApp não são automáticas.** O site monta o texto e abre a
conversa; quem aperta enviar é uma pessoa. Disparo automático exige a WhatsApp
Cloud API, que precisa de backend próprio e migra o número para fora do app
comum. O código está separado para isso: os textos saem de `mensagemStatus()` e
`pedidoParaTexto()`.

**A sessão do painel fica no `localStorage`, não em cookie HttpOnly.** É a
limitação de um site estático sem servidor intermediando o login. Mitigada com
expiração por inatividade.

**O PIX é estático.** O site não recebe confirmação de pagamento — o cliente envia
o comprovante e o lojista confirma. Baixa automática exigiria um PSP com API.

---

Feito por [Gustavo Meirelles](https://github.com/GustavoMeirellesD3V) ·
[gustavodev.api.br](https://gustavodev.api.br)

/* Gera preview/artifact.html: versão em arquivo único (CSS e JS embutidos)
   usada para publicar o preview. O site de produção continua sendo os
   arquivos separados em index.html + assets/. Rode com: node build-preview.js */

const fs = require('fs');
const path = require('path');

const raiz = __dirname;
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

const html = ler('index.html');

const titulo = (html.match(/<title>([\s\S]*?)<\/title>/) || [, 'Açaí Mais Chantilly'])[1];
const corpo = (html.match(/<body>([\s\S]*)<\/body>/) || [, ''])[1]
  .replace(/<script src="assets[\s\S]*?<\/script>/g, '')
  .replace(/<script src="https:\/\/cdnjs[\s\S]*?<\/script>/g, '')
  .trim();

const css = ['assets/css/style.css', 'assets/css/admin.css'].map(ler).join('\n\n');
const js = ['assets/js/qr.js', 'assets/js/store.js', 'assets/js/app.js', 'assets/js/admin.js', 'assets/js/router.js'].map(ler).join('\n\n');

const saida = `<title>${titulo}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">
<style>
${css}
</style>

${corpo}

<script>
${js}
</script>
`;

fs.mkdirSync(path.join(raiz, 'preview'), { recursive: true });
fs.writeFileSync(path.join(raiz, 'preview/artifact.html'), saida);
console.log('preview/artifact.html gerado —', (saida.length / 1024).toFixed(1) + ' KB');

# Medium Translator Gemini

Automação em Google Apps Script que traduz e sintetiza em português as newsletters do Medium recebidas no Gmail, usando a API do Gemini — resolvendo, ao mesmo tempo, a barreira do idioma e a sobrecarga de e-mails. Os resumos são organizados no topo de um Google Doc e os e-mails já processados são arquivados, sem nada ser excluído.

Criado para resolver um problema bem específico: acompanhar boas newsletters em inglês sem o esforço extra de traduzir mentalmente dezenas de títulos e textos todos os dias. O relato completo do processo de criação está neste artigo no Medium: *(adicione aqui o link do seu artigo quando publicar)*.

## O que o script faz

- Todos os dias, busca no Gmail os e-mails do Medium recebidos nas últimas 24 horas.
- Envia o conteúdo de cada e-mail para a API do Gemini, que identifica os artigos recomendados, traduz a ideia central para o português em uma síntese de 2 a 3 frases, e classifica cada um por tema (ex.: `[IA]`, `[Gestão]`, `[Filosofia]`).
- Grava os resumos no topo de um Google Doc, com título original, tag temática, data de envio e link clicável para o artigo completo — as edições mais recentes sempre aparecem primeiro.
- Evita duplicar artigos que já apareceram em newsletters anteriores, comparando as URLs (normalizadas, sem parâmetros de rastreamento) com um histórico curto guardado no próprio script.
- Depois de gravar com sucesso, arquiva os e-mails processados e aplica um label (`Clipping/Processado`), tirando-os da caixa de entrada sem excluir nada — eles continuam pesquisáveis em "Todos os e-mails".
- Se algo falhar em qualquer etapa, envia um e-mail de aviso com o resumo dos erros, em vez de falhar silenciosamente.

## Pré-requisitos

- Uma conta Google (Gmail) que receba as newsletters do Medium.
- Um Google Doc vazio, criado por você, que servirá como o documento de destino do clipping.
- Uma chave de API do Gemini, obtida gratuitamente em [Google AI Studio](https://aistudio.google.com/).

## Como instalar

1. Acesse [script.google.com](https://script.google.com/) e crie um novo projeto.
2. Copie o conteúdo de `clipping-medium.gs` (arquivo deste repositório) e cole no editor do projeto.
3. No menu lateral do editor, vá em **Configurações do Projeto** (ícone de engrenagem) → **Propriedades do Script** → **Adicionar propriedade do script**, e crie uma propriedade chamada `GEMINI_API_KEY` com o valor da sua chave do Google AI Studio. A chave nunca fica escrita no código — isso evita expor sua chave caso o repositório seja público.
4. No topo do script, edite as variáveis de configuração:
   - `GOOGLE_DOC_ID`: o ID do Google Doc de destino — é o trecho da URL entre `/d/` e `/edit` (nunca a URL inteira).
   - `EMAIL_NOTIFICACAO`: o e-mail para onde devem ir os avisos de erro.
   - As demais variáveis (`MODEL_NAME`, `LIMITE_CARACTERES_EMAIL`, `MAX_URLS_HISTORICO`, `NOME_LABEL_PROCESSADO`) já vêm com valores padrão razoáveis, mas podem ser ajustadas.
5. Salve o projeto e execute a função `gerarClippingMediumNoDoc` manualmente uma vez, para autorizar as permissões (acesso ao Gmail, ao Google Docs e à internet).
6. Configure um gatilho (trigger) de tempo para rodar automaticamente todos os dias: no menu lateral, clique no ícone de relógio (**Acionadores**) → **Adicionar Acionador** → função `gerarClippingMediumNoDoc`, evento baseado em tempo, disparador do tipo dia, no horário desejado (por exemplo, 8h da manhã).

## Configuração (variáveis)

| Variável | O que é | Onde configurar |
| --- | --- | --- |
| `GEMINI_API_KEY` | Chave da API do Gemini | Propriedades do Script (nunca no código) |
| `GOOGLE_DOC_ID` | ID do Google Doc de destino | Direto no código |
| `EMAIL_NOTIFICACAO` | E-mail que recebe avisos de erro | Direto no código |
| `MODEL_NAME` | Modelo do Gemini usado | Direto no código (padrão: `gemini-2.5-flash`) |
| `LIMITE_CARACTERES_EMAIL` | Quantos caracteres do e-mail são enviados à IA | Direto no código (padrão: 30000) |
| `MAX_URLS_HISTORICO` | Quantas URLs recentes guardar para deduplicação | Direto no código (padrão: 60) |
| `NOME_LABEL_PROCESSADO` | Nome do label aplicado aos e-mails já processados | Direto no código |

## Limitações conhecidas

- A API do Gemini tem cotas gratuitas de uso (por minuto e por dia) que variam por modelo e podem mudar sem aviso prévio do Google — em volumes muito altos de newsletters, é possível esgotar a cota do dia.
- O script analisa apenas os primeiros `LIMITE_CARACTERES_EMAIL` caracteres de cada e-mail; newsletters muito longas podem ter artigos do final ignorados.
- A deduplicação depende do histórico de URLs guardado no `PropertiesService`, que tem limite de 9 KB por propriedade — por isso o histórico é limitado às últimas URLs mais recentes, não é uma lista permanente.
- O script foi desenhado especificamente para o formato de e-mail das newsletters do Medium; usar com outros remetentes exigiria ajustar o prompt de extração.

## Segurança

A chave da API é armazenada nas Propriedades do Script do Google Apps Script, não no código-fonte — por isso é seguro publicar este repositório publicamente, desde que você não cole sua chave em nenhum arquivo antes de subir. Revise sempre o histórico de commits antes de tornar o repositório público, caso tenha testado com a chave direto no código em algum momento.

## Licença

Este projeto está licenciado sob a licença MIT — de uso livre e gratuito, inclusive para fins comerciais por terceiros, desde que mantido o aviso de copyright original. Veja o arquivo [LICENSE](LICENSE) para o texto completo.

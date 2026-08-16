// ==========================================
// 1. CONFIGURAÇÕES DO USUÁRIO
// ==========================================
// Configure a chave em: Configurações do Projeto > Propriedades do script (GEMINI_API_KEY)
var GEMINI_API_KEY = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
var GOOGLE_DOC_ID = "ID_DO_SEU_GOOGLE_DOC_AQUI"; // ID extraído da URL do seu documento
var EMAIL_NOTIFICACAO = "SEU_EMAIL_AQUI@gmail.com"; // Para onde vão os avisos de erro
var MODEL_NAME = "gemini-2.5-flash"; // Cheque periodicamente na documentação se o modelo está ativo
var LIMITE_CARACTERES_EMAIL = 30000; // Ajuste conforme o tamanho médio das suas newsletters
var MAX_URLS_HISTORICO = 60; // Mantém histórico seguro dentro do limite de 9 KB do PropertiesService
var NOME_LABEL_PROCESSADO = "Clipping/Processado"; // Label aplicado ao thread após arquivar com sucesso

// ==========================================
// 2. FUNÇÃO PRINCIPAL (ORQUESTRADOR DIÁRIO)
// ==========================================
function gerarClippingMediumNoDoc() {
  var erros = [];

  if (!GEMINI_API_KEY) {
    var erroChave = "Chave GEMINI_API_KEY não configurada no PropertiesService do script.";
    Logger.log("ERRO CRÍTICO: " + erroChave);
    notificarErros([erroChave]);
    return;
  }
  try {
    var label = GmailApp.getUserLabelByName(NOME_LABEL_PROCESSADO) || GmailApp.createLabel(NOME_LABEL_PROCESSADO);

    // Exclui da busca qualquer thread já arquivado por uma execução anterior
    var query = 'from:medium.com newer_than:1d -label:"' + NOME_LABEL_PROCESSADO + '"';
    var threads = GmailApp.search(query);

    if (threads.length === 0) {
      Logger.log("Nenhum e-mail novo do Medium encontrado nas últimas 24 horas.");
      return;
    }

    // Ordena os threads do mais recente para o mais antigo
    threads.sort(function(a, b) {
      return b.getLastMessageDate().getTime() - a.getLastMessageDate().getTime();
    });

    var todosArtigos = [];
    var threadsParaArquivar = [];

    for (var t = 0; t < threads.length; t++) {
      var thread = threads[t];
      var messages = thread.getMessages();
      var threadTeveErro = false;
      var artigosDoThread = [];

      for (var j = 0; j < messages.length; j++) {
        var msg = messages[j];
        var dataEnvio = Utilities.formatDate(msg.getDate(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");

        try {
          // Tratamento do corpo do e-mail preservando hiperlinks
          var htmlBody = msg.getBody();
          var textoComLinks = htmlBody.replace(/<a\s+(?:[^>]*?\s+)?href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, " $3 ($2) ");
          var corpoEmail = textoComLinks.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

          // Extrai e sintetiza os dados com a API do Gemini
          var artigosExtraidos = extrairTodosArtigosComGemini(corpoEmail, dataEnvio);
          if (artigosExtraidos && artigosExtraidos.length > 0) {
            Logger.log("Artigos encontrados no thread " + (t + 1) + ": " + artigosExtraidos.length);
            artigosDoThread = artigosDoThread.concat(artigosExtraidos);
          }
        } catch (erroMensagem) {
          var trecho = (msg.getSubject() || "(sem assunto)");
          var motivo = "Falha ao processar a mensagem \"" + trecho + "\" (" + dataEnvio + "): " + erroMensagem.toString();
          Logger.log("ERRO: " + motivo);
          erros.push(motivo);
          threadTeveErro = true;
        }
      }

      todosArtigos = todosArtigos.concat(artigosDoThread);

      // Só marca para arquivar se todas as mensagens do thread foram processadas sem falha
      if (!threadTeveErro) {
        threadsParaArquivar.push(thread);
      }
    }

    // Remove artigos já publicados em edições anteriores
    var artigosNovos = filtrarArtigosDuplicados(todosArtigos);

    if (artigosNovos.length === 0) {
      Logger.log("Nenhum artigo novo (não duplicado) para gravar.");
    } else {
      gravarNoTopoDoGoogleDoc(artigosNovos);
      registrarUrlsProcessadas(artigosNovos);
    }

    // Só arquiva após confirmação de gravação no documento
    arquivarThreadsProcessados(threadsParaArquivar, label);

  } catch (erroGeral) {
    erros.push("Falha geral na execução: " + erroGeral.toString());
    Logger.log("ERRO GERAL: " + erroGeral.toString());
  }

  if (erros.length > 0) {
    notificarErros(erros);
  }
}

// ==========================================
// 2b. ARQUIVAMENTO POR LABEL
// ==========================================
function arquivarThreadsProcessados(threads, label) {
  for (var i = 0; i < threads.length; i++) {
    try {
      threads[i].moveToArchive();
      threads[i].addLabel(label);
    } catch (erroArquivo) {
      Logger.log("Não foi possível arquivar/rotular um thread: " + erroArquivo.toString());
    }
  }
  if (threads.length > 0) {
    Logger.log(threads.length + " thread(s) arquivado(s) e marcado(s) como processado(s).");
  }
}

// ==========================================
// 3. DEDUPLICAÇÃO E NORMALIZAÇÃO DE URL
// ==========================================
function normalizarUrl(url) {
  if (!url) return "";
  // 1. Isola fragmento (#) e remove barra final da base
  var semFragmento = url.split("#")[0].trim();
  var partesQuery = semFragmento.split("?");
  var baseUrl = partesQuery[0].replace(/\/+$/, "");
  // Se não houver query string, retorna apenas a URL base limpa
  if (partesQuery.length < 2 || !partesQuery[1]) {
    return baseUrl;
  }
  // Lista de chaves/prefixos de rastreamento conhecidos a serem ignorados
  var parametrosRastreamento = ["source", "gi", "sk", "responsesopen"];
  var paramsValidos = [];
  // 2. Separa cada par chave=valor
  var pares = partesQuery[1].split("&");
  for (var i = 0; i < pares.length; i++) {
    var par = pares[i].trim();
    if (!par) continue;
    var chave = par.split("=")[0].toLowerCase();
    // Filtra parâmetros que começam com 'utm_' ou coincidem com a lista de trackers
    var ehRastreamento = chave.startsWith("utm_") || parametrosRastreamento.indexOf(chave) !== -1;
    if (!ehRastreamento) {
      paramsValidos.push(par);
    }
  }
  // 3. Reconstrói a query string garantindo o '?' inicial se restarem parâmetros
  if (paramsValidos.length > 0) {
    return baseUrl + "?" + paramsValidos.join("&");
  }
  return baseUrl;
}
function filtrarArtigosDuplicados(artigos) {
  var props = PropertiesService.getScriptProperties();
  var historicoJson = props.getProperty("URLS_JA_PUBLICADAS");
  var historico = historicoJson ? JSON.parse(historicoJson) : [];
  var historicoSet = {};
  for (var i = 0; i < historico.length; i++) {
    historicoSet[historico[i]] = true;
  }

  var vistosNestaExecucao = {};
  var resultado = [];

  for (var j = 0; j < artigos.length; j++) {
    var artigo = artigos[j];
    var urlOriginal = (artigo.link || "").trim();

    if (!urlOriginal || !urlOriginal.startsWith("http")) {
      resultado.push(artigo);
      continue;
    }

    var urlNormalizada = normalizarUrl(urlOriginal);

    if (historicoSet[urlNormalizada] || vistosNestaExecucao[urlNormalizada]) {
      Logger.log("Artigo duplicado ignorado: " + artigo.tituloOriginal + " (" + urlNormalizada + ")");
      continue;
    }

    vistosNestaExecucao[urlNormalizada] = true;
    resultado.push(artigo);
  }

  return resultado;
}

function registrarUrlsProcessadas(artigos) {
  var props = PropertiesService.getScriptProperties();
  var historicoJson = props.getProperty("URLS_JA_PUBLICADAS");
  var historico = historicoJson ? JSON.parse(historicoJson) : [];

  for (var i = 0; i < artigos.length; i++) {
    var urlNormalizada = normalizarUrl(artigos[i].link);
    if (urlNormalizada && urlNormalizada.startsWith("http")) {
      historico.push(urlNormalizada);
    }
  }

  if (historico.length > MAX_URLS_HISTORICO) {
    historico = historico.slice(historico.length - MAX_URLS_HISTORICO);
  }

  props.setProperty("URLS_JA_PUBLICADAS", JSON.stringify(historico));
}

// ==========================================
// 4. NOTIFICAÇÃO DE ERROS POR E-MAIL
// ==========================================
function notificarErros(listaErros) {
  if (!EMAIL_NOTIFICACAO || EMAIL_NOTIFICACAO === "SEU_EMAIL_AQUI@gmail.com") {
    Logger.log("EMAIL_NOTIFICACAO não configurado; erros só disponíveis no Logger.log.");
    return;
  }

  try {
    var assunto = "⚠️ Clipping Medium: " + listaErros.length + " erro(s) na execução de hoje";
    var corpo = "A execução do script de clipping encontrou os seguintes problemas:\n\n" +
      listaErros.map(function(e, idx) { return (idx + 1) + ". " + e; }).join("\n\n") +
      "\n\nVerifique o Logger de execuções no Apps Script para mais detalhes.";
    MailApp.sendEmail(EMAIL_NOTIFICACAO, assunto, corpo);
  } catch (erroEnvio) {
    Logger.log("Falha ao enviar e-mail de notificação de erro: " + erroEnvio.toString());
  }
}

// ==========================================
// 5. FORMATAÇÃO E GRAVAÇÃO NO GOOGLE DOCS
// ==========================================
function gravarNoTopoDoGoogleDoc(artigos) {
  var doc = DocumentApp.openById(GOOGLE_DOC_ID);
  var body = doc.getBody();
  var hojeFormatado = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");

  var pos = 0;

  var cabecalhoSecao = body.insertParagraph(pos++, "📰 Edição — " + hojeFormatado);
  cabecalhoSecao.setFontSize(16);
  cabecalhoSecao.setBold(true);
  cabecalhoSecao.setForegroundColor("#1a73e8");

  for (var i = 0; i < artigos.length; i++) {
    var artigo = artigos[i];
    var categoriaTag = artigo.categoria ? "[" + artigo.categoria + "] " : "";

    var tituloParagrafo = body.insertParagraph(pos++, (i + 1) + ". " + categoriaTag + artigo.tituloOriginal);
    tituloParagrafo.setFontSize(13);
    tituloParagrafo.setBold(true);
    tituloParagrafo.setForegroundColor("#202124");

    var pSintese = body.insertParagraph(pos++, "• Síntese: " + artigo.sintese);
    pSintese.setFontSize(11);
    pSintese.setForegroundColor("#3c4043");

    var pMeta = body.insertParagraph(pos++, "• Data do e-mail: " + artigo.dataEnvio + " | ");
    pMeta.setFontSize(10);
    pMeta.setForegroundColor("#5f6368");

    var linkTexto = pMeta.appendText("Ler artigo integral no Medium ↗");
    linkTexto.setLinkUrl(artigo.link && artigo.link.startsWith("http") ? artigo.link : "https://medium.com");
    linkTexto.setBold(true);
    linkTexto.setForegroundColor("#1a73e8");

    var divisor = body.insertParagraph(pos++, "—————————————————————————————————————————————");
    divisor.setFontSize(9);
    divisor.setForegroundColor("#dadce0");
  }

  body.insertParagraph(pos, "");

  doc.saveAndClose();
  Logger.log("Sucesso: " + artigos.length + " artigo(s) gravado(s) no topo do documento!");
}

// ==========================================
// 6. CURADORIA, TRADUÇÃO E IA COM GEMINI
// ==========================================
function extrairTodosArtigosComGemini(conteudoEmail, dataEnvio) {
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + MODEL_NAME + ":generateContent?key=" + GEMINI_API_KEY;

  var prompt = "Você é um assistente editorial.\n" +
    "Analise o texto desta newsletter do Medium e extraia todas as postagens recomendadas.\n" +
    "OBS: Os links originais de cada artigo estão entre parênteses (http...) logo ao lado do título ou resumo no texto fornecido.\n\n" +
    "Retorne um array JSON contendo objetos com os campos:\n" +
    '- "dataEnvio": "' + dataEnvio + '"\n' +
    '- "categoria": "Uma tag curta do assunto (ex: IA, Tecnologia, Gestão, Produtividade, Filosofia, etc.)"\n' +
    '- "tituloOriginal": "Título original exato do artigo"\n' +
    '- "sintese": "Resumo de 2 a 3 frases em português com a ideia central"\n' +
    '- "link": "A URL completa e exata do artigo que foi fornecida entre parênteses"\n\n' +
    'Texto do e-mail:\n"""\n' + conteudoEmail.substring(0, LIMITE_CARACTERES_EMAIL) + '\n"""';

  var payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.1,
      response_mime_type: "application/json" // Mantido rigorosamente no padrão da API REST
    }
  };

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var codigoResposta = response.getResponseCode();

    if (codigoResposta === 200) {
      var json = JSON.parse(response.getContentText());

      if (!json.candidates || !json.candidates[0] || !json.candidates[0].content ||
          !json.candidates[0].content.parts || !json.candidates[0].content.parts[0]) {
        Logger.log("Resposta da API sem o formato esperado: " + response.getContentText().substring(0, 500));
        return [];
      }

      var textoResposta = json.candidates[0].content.parts[0].text;

      try {
        // Limpeza defensiva contra eventuais blocos de código Markdown
        var textoLimpo = textoResposta.replace(/```json/gi, "").replace(/```/g, "").trim();
        return JSON.parse(textoLimpo);
      } catch (erroParseJson) {
        Logger.log("Erro ao interpretar JSON retornado pelo Gemini: " + erroParseJson.toString() +
          " | Trecho recebido: " + textoResposta.substring(0, 500));
        return [];
      }

    } else if (codigoResposta === 429) {
      Logger.log("Limite de requisições da API do Gemini atingido (429). Tente novamente mais tarde.");
      return [];
    } else {
      Logger.log("Erro API (" + codigoResposta + "): " + response.getContentText().substring(0, 500));
      return [];
    }
  } catch (e) {
    Logger.log("Erro na extração (rede/execução): " + e.toString());
    return [];
  }
}

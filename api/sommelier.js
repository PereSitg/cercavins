// ... (mantenim la inicialització d'admin i db igual) ...

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;
    const p = pregunta.toLowerCase();

    // 1. CERCA PRINCIPAL (Segons el que demana l'usuari)
    let consulta = db.collection('cercavins');
    if (p.includes('priorat')) consulta = consulta.where('do', '==', 'Priorat');
    else if (p.includes('rioja')) consulta = consulta.where('do', '==', 'Rioja');
    else if (p.includes('ribera')) consulta = consulta.where('do', '==', 'Ribera del Duero');
    else if (p.includes('xampany') || p.includes('champagne')) consulta = consulta.where('do', '==', 'Champagne');
    
    const snapshot = await consulta.limit(40).get();
    let celler = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      celler.push({ nom: d.nom, imatge: d.imatge, do: d.do, preu: d.preu });
    });

    // 2. CERCA DE "VINS ASSEQUIBLES" (7€ - 20€) per oferir opcions
    // Busquem vins de qualsevol DO que estiguin en aquest rang
    const assequiblesSnapshot = await db.collection('cercavins')
      .where('preu', '>=', 7)
      .where('preu', '<=', 20)
      .limit(15)
      .get();

    let vinsBarats = [];
    assequiblesSnapshot.forEach(doc => {
      const d = doc.data();
      vinsBarats.push({ nom: d.nom, imatge: d.imatge, do: d.do, preu: d.preu, etiqueta: "assequible" });
    });

    // Ajuntem les dues llistes per enviar-les a la IA
    const contextIA = [...celler, ...vinsBarats];

    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH' };
    const idiomaRes = langMap[idioma?.slice(0, 2)] || 'CATALÀ';

    // 3. CRIDA A GROQ AMB ORDRE DE "TERCER VI ECONÒMIC"
    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        response_format: { type: "json_object" },
        messages: [
          {
            role: 'system',
            content: `Ets un sommelier expert. Idioma: ${idiomaRes}.
            NORMES DE SELECCIÓ:
            - Has de triar SEMPRE 3 vins.
            - El tercer vi ha de ser obligatòriament un dels que tenen l'etiqueta "assequible" (preu entre 7€ i 20€).
            - Presenta aquest tercer vi com una "opció amb excel·lent relació qualitat-preu" o "una troballa assequible".
            - No diguis el preu numèric, però explica que és una opció més econòmica.
            - Mantén el format <span class="nom-vi-destacat"> i no usis majúscules a cada paraula.`
          },
          {
            role: 'user',
            content: `Llista de vins: ${JSON.stringify(contextIA)}. Pregunta: ${pregunta}`
          }
        ],
        temperature: 0.4
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    const respostaFinal = `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats)}`;
    res.status(200).json({ resposta: respostaFinal });

  } catch (error) {
    res.status(200).json({ resposta: `Error: ${error.message} ||| []` });
  }
};

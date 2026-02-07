const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;
    const p = pregunta.toLowerCase();

    // 1. ESTRATÈGIA DE FILTRATGE (Basat en la teva nova BBDD neta)
    let consulta = db.collection('cercavins');
    
    // Intentem detectar si l'usuari demana una regió específica que ja tenim neta
    if (p.includes('priorat')) consulta = consulta.where('do', '==', 'Priorat');
    else if (p.includes('rioja')) consulta = consulta.where('do', '==', 'Rioja');
    else if (p.includes('ribera')) consulta = consulta.where('do', '==', 'Ribera del Duero');
    else if (p.includes('champagne') || p.includes('xampany')) consulta = consulta.where('do', '==', 'Champagne');
    else if (p.includes('borgonya') || p.includes('burgundy')) consulta = consulta.where('do', '==', 'Borgonya');
    else if (p.includes('pauillac')) consulta = consulta.where('do', '==', 'Pauillac');
    else if (p.includes('sicília') || p.includes('etna')) consulta = consulta.where('do', '==', 'Sicília');

    // Limitem a 60 per donar varietat a la IA sense saturar el timeout
    const snapshot = await consulta.limit(60).get();
    
    let celler = [];
    snapshot.forEach(doc => {
      const d = doc.data();
      if (d.nom && d.imatge) {
        celler.push({ 
          nom: d.nom, 
          imatge: d.imatge, 
          do: d.do || "", 
          preu: d.preu || "Preu a consultar" 
        });
      }
    });

    // Si el filtre ha estat massa estricte i no han sortit vins, fem una cerca general
    if (celler.length < 5) {
      const backupSnapshot = await db.collection('cercavins').limit(40).get();
      backupSnapshot.forEach(doc => {
        const d = doc.data();
        celler.push({ nom: d.nom, imatge: d.imatge, do: d.do || "", preu: d.preu || "" });
      });
    }

    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const idiomaRes = langMap[idioma?.slice(0, 2)] || 'CATALÀ';

    // 2. CRIDA A GROQ AMB CONTEXT ENRIQUIT
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
            content: `Ets un sommelier expert i elegant. Respon SEMPRE en format JSON.
            Idioma: ${idiomaRes}.
            Normes: Frases amb majúscula inicial. Noms de vins en <span class="nom-vi-destacat">.
            Context: Tens accés a vins amb la seva DO i Preu. Sigues precís en la recomanació.
            
            Estructura:
            {
              "explicacio": "Text personalitzat segons la DO i el preu...",
              "vins_triats": [{"nom": "Nom", "imatge": "URL"}]
            }`
          },
          {
            role: 'user',
            content: `Celler disponible (mostra de ${celler.length} vins): ${JSON.stringify(celler)}. Pregunta de l'usuari: ${pregunta}`
          }
        ],
        temperature: 0.3 // Pugem una mica per fer-lo més "humà" i menys robòtic
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

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
    
    // 1. Configuració d'Idioma
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const codiClient = (idioma || 'ca').toLowerCase().slice(0, 2);
    const idiomaReal = langMap[codiClient] || 'CATALÀ';

    // 2. Extracció de paraules clau per a la cerca (països, regions, raïm)
    const paraulesClau = p.split(/[ ,.!?]+/).filter(w => w.length > 3);

    // 3. Recuperació de vins de Firebase (ampliem a 60 per tenir base on triar)
    let refAlta = db.collection('cercavins').where('preu', '>', 35);
    let refEcon = db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18);

    // Filtre bàsic per tipus si es detecta a la pregunta
    if (p.includes('blanc')) {
        refAlta = refAlta.where('tipus', '==', 'Blanc');
        refEcon = refEcon.where('tipus', '==', 'Blanc');
    } else if (p.includes('negre') || p.includes('tinto')) {
        refAlta = refAlta.where('tipus', '==', 'Negre');
        refEcon = refEcon.where('tipus', '==', 'Negre');
    }

    const [premSnap, econSnap] = await Promise.all([
      refAlta.limit(60).get(),
      refEcon.limit(60).get()
    ]);

    // 4. Filtratge Intel·ligent en Memòria (Global: Regions, Països i Varietats)
    const processarVins = (snap) => {
      return snap.docs
        .map(doc => ({
          nom: doc.data().nom,
          do: doc.data().do || "DO",
          preu: doc.data().preu,
          imatge: doc.data().imatge,
          varietat: doc.data().varietat || ""
        }))
        .filter(v => {
          if (v.do === "Vila Viniteca" || v.do === "Desconeguda") return false;
          
          // Si no hi ha paraules clau, passem tots (aleatoris)
          if (paraulesClau.length === 0) return true;

          // Si l'usuari busca "Bordeaux" o "Chardonnay", comprovem si el vi ho té
          return paraulesClau.some(clau => 
            v.nom.toLowerCase().includes(clau) || 
            v.do.toLowerCase().includes(clau) || 
            v.varietat.toLowerCase().includes(clau)
          );
        })
        .sort(() => Math.random() - 0.5)
        .slice(0, 20); // Enviem un màxim de 20 de cada a la IA (40 total)
    };

    const llistaAlta = processarVins(premSnap);
    const llistaEcon = processarVins(econSnap);

    // 5. Prompt de Sistema (Sommelier Internacional)
    const promptSystem = `Eres un Sommelier de élite internacional.
    INSTRUCCIÓN DE IDIOMA: Responde estrictamente en ${idiomaReal}.
    
    INSTRUCCIÓN DE FORMATO:
    - Cada VI: <span class="nom-vi-destacat">NOM DEL VI</span>.
    - Cada DO/Región: <span class="text-destacat-groc">NOM DO</span>.
    - Escribe unas 250 palabras con un tono experto y sugerente.

    Vinos disponibles para esta consulta: ${JSON.stringify({alta_gama: llistaAlta, economicos: llistaEcon})}

    JSON OBLIGATORIO: {"explicacio": "Texto con HTML...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', 
        response_format: { type: "json_object" },
        messages: [
          { role: 'system', content: promptSystem },
          { role: 'user', content: `Consulta del cliente: "${pregunta}"` }
        ],
        temperature: 0.4
      })
    });

    const data = await groqResponse.json();
    if (data.error) throw new Error(data.error.message);

    const contingut = JSON.parse(data.choices[0].message.content);
    const vinsFinals = (contingut.vins_triats || []).slice(0, 3);
    const textFinal = contingut.explicacio || "Aquí tienes mi selección...";

    res.status(200).json({ 
      resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` 
    });

  } catch (error) {
    console.error("ERROR SOMMELIER:", error.message);
    res.status(200).json({ 
      resposta: `Ho sento, el sommelier està tastant un nou vi i no pot atendre't. ||| []` 
    });
  }
};

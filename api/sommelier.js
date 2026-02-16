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

    // 2. Paraules clau (percebes, priorat, etc.)
    const paraulesClau = p.split(/[ ,.!?]+/).filter(w => w.length > 3);

    // 3. Consultes a Firebase
    let refAlta = db.collection('cercavins').where('preu', '>', 35);
    let refEcon = db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18);

    if (p.includes('blanc') || p.includes('blanco')) {
        refAlta = refAlta.where('tipus', '==', 'Blanc');
        refEcon = refEcon.where('tipus', '==', 'Blanc');
    } else if (p.includes('negre') || p.includes('tinto')) {
        refAlta = refAlta.where('tipus', '==', 'Negre');
        refEcon = refEcon.where('tipus', '==', 'Negre');
    }

    const [premSnap, econSnap] = await Promise.all([
      refAlta.limit(80).get(),
      refEcon.limit(80).get()
    ]);

    // 4. Processament amb focus en IMATGES i ENCAIX
    const processarVins = (snap) => {
      return snap.docs
        .map(doc => ({
          nom: doc.data().nom,
          do: doc.data().do || "DO",
          preu: doc.data().preu,
          imatge: doc.data().imatge, // CRÍTIC: Passem la URL de la imatge
          varietat: doc.data().varietat || ""
        }))
        .filter(v => {
          if (v.do === "Vila Viniteca" || !v.imatge) return false; // Filtrem si no té foto
          if (paraulesClau.length === 0) return true;
          return paraulesClau.some(clau => 
            v.nom.toLowerCase().includes(clau) || 
            v.do.toLowerCase().includes(clau) || 
            v.varietat.toLowerCase().includes(clau)
          );
        })
        .sort(() => Math.random() - 0.5)
        .slice(0, 20);
    };

    const llistaAlta = processarVins(premSnap);
    const llistaEcon = processarVins(econSnap);

    // 5. PROMPT REFORÇAT (Més llarg i amb imatges obligatòries)
    const promptSystem = `Ets un Sommelier d'elit. 
    INSTRUCCIÓ D'IDIOMA: Respon exclusivament en ${idiomaReal}.
    
    INSTRUCCIÓ DE FORMAT:
    - Usa <span class="nom-vi-destacat"> pel nom del vi.
    - Usa <span class="text-destacat-groc"> per la DO.
    
    INSTRUCCIÓ DE CONTINGUT:
    - L'explicació ha de ser MAGISTRAL i EXTENSA (mínim 300 paraules). 
    - No et limitis a llistar els vins. Explica la nota de tast, per què mariden amb la consulta i la història de la zona. 
    - Sigues apassionat i expert.
    
    IMATGES OBLIGATÒRIES: Per a cada vi triat, has d'incloure la seva URL d'imatge exacta del JSON que t'he passat.

    Vins disponibles: ${JSON.stringify({alta: llistaAlta, barats: llistaEcon})}

    JSON OBLIGATORI: {"explicacio": "Text HTML llarg...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

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
          { role: 'user', content: `Consulta: ${pregunta}` }
        ],
        temperature: 0.5 // Pugem una mica per evitar respostes genèriques
      })
    });

    const data = await groqResponse.json();
    if (data.error) throw new Error(data.error.message);

    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Assegurem que agafem els vins del camp correcte del JSON
    const vinsFinals = (contingut.vins_triats || []).slice(0, 3);
    const textFinal = contingut.explicacio;

    res.status(200).json({ 
      resposta: `${textFinal} ||| ${JSON.stringify(vinsFinals)}` 
    });

  } catch (error) {
    console.error("ERROR:", error.message);
    res.status(200).json({ 
      resposta: `Ho sento, el sommelier està decantant un vi. Torna-ho a provar. ||| []` 
    });
  }
};

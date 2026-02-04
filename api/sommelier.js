const admin = require('firebase-admin');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;

    let llenguaResposta = "CATALÀ";
    let termeUva = "raïm"; 
    
    if (idioma) {
        if (idioma.startsWith('es')) {
            llenguaResposta = "CASTELLÀ (ESPAÑOL)";
            termeUva = "uva";
        } else if (idioma.startsWith('fr')) {
            llenguaResposta = "FRANCÈS (FRANÇAIS)";
            termeUva = "raisin";
        } else if (idioma.startsWith('en')) {
            llenguaResposta = "ANGLÈS (ENGLISH)";
            termeUva = "grape";
        }
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim(),
        }),
      });
    }
    
    const db = admin.firestore();
    
    // --- NOU SISTEMA DE FILTRATGE ---
    // Extraiem paraules clau de la pregunta per buscar-les a Firebase
    const paraulesClau = pregunta.split(' ')
        .filter(p => p.length > 3) // Només paraules significatives
        .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());

    let query = db.collection('cercavins');
    
    // Si l'usuari menciona un nom (com Cune), intentem filtrar per nom
    // Si no, portem un pool de 50 vins (més marge que 20) per triar
    let snapshot;
    if (paraulesClau.length > 0) {
        // Busquem vins que comencin per la paraula principal de la cerca
        snapshot = await query.where('nom', '>=', paraulesClau[0])
                              .where('nom', '<=', paraulesClau[0] + '\uf8ff')
                              .limit(40).get();
    } 
    
    // Si la cerca específica no dóna fruits, portem 40 vins variats
    if (!snapshot || snapshot.empty) {
        snapshot = await query.limit(40).get();
    }

    let celler = [];
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler.push({ nom: d.nom, do: d.do, imatge: d.imatge, tipus: d.tipus });
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', 
        messages: [
          { 
            role: 'system', 
            content: `Ets el sommelier de Cercavins.
            1. Respon en ${llenguaResposta}.
            2. Recomana 3-4 vins del JSON enviat.
            3. Si el vi que demana l'usuari NO és al JSON, digues-li amb educació que no el tens en estoc actualment, però recomana'n un de similar del llistat que sí tens.
            4. FORMAT: [Text]|||[JSON]. Cap frase extra després de |||.`
          },
          { role: 'user', content: `Celler: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
        ],
        temperature: 0.1
      })
    });

    const data = await response.json();
    res.status(200).json({ resposta: data.choices[0].message.content });

  } catch (error) {
    res.status(500).json({ resposta: "Error: " + error.message });
  }
};

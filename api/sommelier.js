const admin = require('firebase-admin');

module.exports = async (req, res) => {
    // 1. Seguretat bàsica
    if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

    try {
        const { pregunta, idioma } = req.body;

        // 2. Idioma
        let llenguaResposta = "CATALÀ";
        if (idioma) {
            if (idioma.startsWith('fr')) llenguaResposta = "FRANCÈS";
            else if (idioma.startsWith('es')) llenguaResposta = "CASTELLÀ";
            else if (idioma.startsWith('en')) llenguaResposta = "ANGLÈS";
        }

        // 3. Inicialitzar Firebase (només si no està ja obert)
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
        const snapshot = await db.collection('cercavins').limit(40).get();
        let celler = [];

        snapshot.forEach(doc => {
            const d = doc.data();
            celler.push({
                nom: d.nom,
                do: d.do,
                imatge: d.imatge,
                tipus: d.tipus
            });
        });

        // 4. Crida a la IA (Groq)
        const responseIA = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: 'system',
                        content: `Ets un Sommelier d'elit. 
                        INSTRUCCIÓ RAÏM: Identifica el raïm de cada vi per memòria. Explica per què marida.
                        PROHIBIT dir que no tens dades. Actua amb autoritat.
                        IDIOMA: Respon EXCLUSIVAMENT en ${llenguaResposta}.
                        FORMAT: Sense asteriscs. Separa amb "|||" i el JSON final.`
                    },
                    { role: 'user', content: `Celler: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
                ],
                temperature: 0.7
            })
        });

        // 5. Validació de la resposta abans d'enviar
        const dataIA = await responseIA.json();

        if (dataIA.choices && dataIA.choices[0]) {
            return res.status(200).json({ resposta: dataIA.choices[0].message.content });
        } else {
            console.error("Error Groq:", dataIA);
            return res.status(500).json({ resposta: "La IA no ha contestat correctament." });
        }

    } catch (error) {
        console.error("Error General:", error);
        return res.status(500).json({ resposta: "Error de servidor: " + error.message });
    }
};

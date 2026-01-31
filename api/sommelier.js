export const config = {
  runtime: 'nodejs'
}

const admin = require('firebase-admin')

// ----------------------
// Fix per node-fetch ESM
// ----------------------
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args))

let db

// ----------------------
// Inicialització Firebase
// ----------------------
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    })

    db = admin.firestore()
    console.log('🔥 Firestore inicialitzat correctament!')
  } catch (error) {
    console.error('❌ Error inicialitzant Firebase:', error)
  }
} else {
  db = admin.firestore()
  console.log('🔥 Firestore ja estava inicialitzat!')
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Mètode no permès' })
  }

  try {
    if (!db) {
      throw new Error('Firestore no inicialitzat')
    }

    const { pregunta } = req.body
    if (!pregunta) {
      return res.status(400).json({ error: 'Falta la pregunta' })
    }

    // ----------------------
    // Log abans de la consulta
    // ----------------------
    console.log('Firestore object abans de consultar:', db)

    const snapshot = await db.collection('cercavins').get()

    let celler = 'Llista de vins de la base de dades:\n'
    snapshot.forEach(doc => {
      const d = doc.data()
      celler += `- ${d.nom} de la DO ${d.do}. Preu: ${d.preu}\n`
    })

    // ----------------------
    // Crida a l'API Groq
    // ----------------------
    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content:
                `Ets el sommelier d'en Pere Badia. ` +
                `Aquests són els vins reals del celler:\n${celler}\n` +
                `Respon sempre en català de forma amable.`
            },
            { role: 'user', content: pregunta }
          ]
        })
      }
    )

    const data = await response.json()

    // ----------------------
    // Log complet de Groq
    // ----------------------
    console.log('🔥 Data completa de Groq:', JSON.stringify(data, null, 2))

    // ----------------------
    // Extracció segura de la resposta
    // ----------------------
    let resposta = 'Sense resposta'

    // Groq a vegades envia resposta en data?.results[0]?.content
    if (data?.results?.length > 0 && data.results[0].content) {
      resposta = data.results[0].content
    } else if (data?.choices?.length > 0 && data.choices[0]?.message?.content) {
      resposta = data.choices[0].message.content
    }

    console.log('✅ Resposta final del sommelier:', resposta)

    res.status(200).json({ resposta })
  } catch (error) {
    console.error('❌ Error API:', error)
    res.status(500).json({ error: error.message })
  }
}

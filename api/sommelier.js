const admin = require('firebase-admin');

// Hem netejat la clau per evitar l'error de format PEM
const serviceAccount = {
  "type": "service_account",
  "project_id": "cercavins-10b76",
  "private_key_id": "9a0af47dff038e8834829a6feacb7eab2de04fff",
  "private_key": "-----BEGIN PRIVATE KEY-----\n" +
    "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDJmqFVzMzWpCh2\n" +
    "439PsGCPJ5/197V/t89kFIUFncpylxzULd8xHUej7st1Z/lK4FV59kTdx9QpZWuc\n" +
    "MDVF3Z9SuuMem+ZJ0FzZfMmbB5XXvlHMv6HhoU8rzygzc/Jao2+q7nqNUsggheFd\n" +
    "RS3+PAerGClDLQszRFvIp8mCQrgdk+MUFIpZAx+wbLt6RuEur5hzOXwxMf3LIeaG\n" +
    "aHNySgeM7X4ba+4hcFkUpimYB0PrGkWX6rpMf3CXCE7JtDadRb8npyoIaJeomdWs\n" +
    "TkxsUDBKkWeW4JrmrTVoalmsSCO7KWHu66Xhi1WxIq8aGlviMUBJCe4bxB+mKgBJ\n" +
    "RGvGW5nZAgMBAAECggEAA4CSre1lX5MxesM/+m/rdYEwN7MqbYIRccEjgHH5ytzS\n" +
    "LONxHabPEEt9MFhyjbjw8zHyh1HJ30A6StfRjRmpA2RovqbhrMWYX1TaIb3TfhB5\n" +
    "1k877jIBsJakMaShgK6XKYaEDYFzJZF91UN25ZRAY9oDGX4mVCkrWQSFLSSgky7v\n" +
    "Ghc/QWXf2YNpQ99xfzypSoGHftxrLc3rynD/uLh16Ta2O/J9tF06ZE9hMqqgppVk\n" +
    "o/PqWMgjyUcYlxJQAt/NBogdqlem4CsQgxjSpcdBGQTy0E4BX55HsBOdQG0SeXYE\n" +
    "DsOxvYPqB0kNsnhJz6zJWSt7PmzH/qcmrQ23KyKpAwKBgQDxV6Lw6KJfyf/ej7sv\n" +
    "+4pYYfF5z+Ia2cBa4SmaeafTaYf4mJf2yERZVT+n0ZAbGIp3v60jZvRbI2jhjxJG\n" +
    "NpaFkWVbt6fS1f3ZfHuf4a2eLpcaOH+11JpEKl8j8XJoWvbVKwjxFEEUMzQVNxF8\n" +
    "M1v1RCndL46DR6xVqSRy7kJpvwKBgQDV2SWh1qil9E7IKlu25KJ9TbIkPu2daW6t\n" +
    "oT7Plx31QGAi/N/2QbB+q8bbQhBUD2AyRzHxIeulCqQQ4y9bDcuxIt+chNk6sDg4\n" +
    "aYkz/su/W0PBc1S2YonSsao4+y8Fy8s5R7Ur7dwQ4L0GJn6/iV9ZpQMNAj1i7tED\n" +
    "vEGmlHRyZwKBgQC5/Xm7Au0vuPKRSF9PqSCC4GhCIez0GF/fKarwO1UU3j1FXgOu\n" +
    "0cOqvMHjyOKvnwgHJRZ/M/aYzf8j5SiGJ8d0hAqC1lRlbTjGhOKY4kj0oJ8eO/Bf\n" +
    "5spEQgs0Hfy3Y3LZ8OJhN+S3doZq2xeEiegSakeBCAdiMLglA8btM6TG7QKBgQCX\n" +
    "lVf2kwlysW2St2vRhdmkRonK5YxbM1wP2aeDUNQcf2hmBKfgkAnCkJLh4r9eRpPi\n" +
    "r9K34Vp+378SdWeg/HNxeY3WDdlJn5YKbsyhva/BUbkCjHT0335gii1mPK7FRgMk\n" +
    "9C55GB8RG60BihH4RTEAg1ZZR0gqM6yXID/NC5hLawKBgFUISUsy/gCKDS7nBgVH\n" +
    "V4XRuMkSzbxj8i52y2m7AfVL7fL1hClTB9zYP37bYFtk3H7DNNw5QOyKV4dHlqmp\n" +
    "nqZnGRxbgASCYkqxX08NxOlhWZKsJrTEJVet5pKjrDQphg42TMXLn+MqNLfLuB6+\n" +
    "zshoY8+uDL1ZAZEKpNet0UrB\n" +
    "-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-fbsvc@cercavins-10b76.iam.gserviceaccount.com"
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta } = req.body;
    const clauGroq = "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";

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    
    const db = admin.firestore();
    const snapshot = await db.collection('cercavins').get();
    let celler = 'Llista de vins del celler d\'en Pere:\n';
    
    snapshot.forEach(doc => { 
      const d = doc.data();
      celler += `- ${d.nom} (DO ${d.do}, Preu: ${d.preu}€)\n`; 
    });

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${clauGroq}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'Ets el sommelier d\'en Pere. Respon en català de forma amable. Aquests són els vins: ' + celler },
          { role: 'user', content: pregunta }
        ]
      })
    });

    const data = await response.json();
    
    if (data.choices && data.choices[0]) {
      res.status(200).json({ resposta: data.choices[0].message.content });
    } else {
      res.status(200).json({ resposta: "Error de resposta de Groq." });
    }

  } catch (error) {
    res.status(500).json({ resposta: "Error: " + error.message });
  }
};

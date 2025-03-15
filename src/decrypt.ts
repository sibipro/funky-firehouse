const decodeBase64 = (b64: string) => new Uint8Array([...atob(b64)].map((c) => c.charCodeAt(0)))

export const decrypt = async (body: string, preSharedKey: string, iv: string, authTag: string) => {
  const keyBinary = decodeBase64(preSharedKey)
  const key = await crypto.subtle.importKey('raw', keyBinary, { name: 'AES-GCM' }, false, ['decrypt'])

  const ivBinary = decodeBase64(iv)
  const bodyBinary = decodeBase64(body)
  const authTagBinary = decodeBase64(authTag)

  if (ivBinary.length !== 12 || authTagBinary.length !== 16) {
    console.error('Invalid IV or authTag length')
    return null
  }

  try {
    const fullCiphertext = new Uint8Array([...bodyBinary, ...authTagBinary])

    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBinary }, key, fullCiphertext)
    const message = new TextDecoder().decode(decrypted)
    return JSON.parse(message)
  } catch (error) {
    console.error('Error decrypting message', error)
    return null
  }
}

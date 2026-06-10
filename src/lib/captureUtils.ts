/**
 * Utilitários de captura para a comprovação geolocalizada do Partido:
 * - getGeo: posição GPS atual (captura no ato, não EXIF — difícil de falsificar)
 * - compressImage: reduz a foto p/ ~800px JPEG 0.5 (mantém leve p/ caber na cota)
 */
export const getGeo = (): Promise<{ lat: number; lng: number }> =>
  new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('GPS indisponível neste dispositivo.'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e?.message || 'Não foi possível obter o GPS.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });

export const compressImage = (file: File, max = 800, quality = 0.5): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > max) { height = Math.round((height * max) / width); width = max; }
        else if (height >= width && height > max) { width = Math.round((width * max) / height); height = max; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Falha ao processar a imagem.'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });

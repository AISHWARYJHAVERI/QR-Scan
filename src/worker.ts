import { readBarcodes, prepareZXingModule } from 'zxing-wasm/reader';

// Preload the WASM module immediately (loads from CDN once, then caches)
prepareZXingModule({ fireImmediately: false });

let tryInvert = false;

self.onmessage = async (event) => {
    const id = event.data.id;
    const type = event.data.type;
    const data = event.data.data;

    switch (type) {
        case 'decode':
            await decode(data, id);
            break;
        case 'inversionMode':
            setInversionMode(data);
            break;
        case 'grayscaleWeights':
            break;
        case 'close':
            self.close();
            break;
    }
};

async function decode(data: { data: Uint8ClampedArray, width: number, height: number }, requestId: number): Promise<void> {
    const rgbaData = data.data;
    const width = data.width;
    const height = data.height;

    const imageData = new ImageData(
        new Uint8ClampedArray(rgbaData),
        width,
        height
    );

    try {
        const results = await readBarcodes(imageData, {
            formats: ['QRCode'],
            tryHarder: true,
            tryRotate: true,
            tryInvert,
            tryDownscale: true,
        });

        if (results.length > 0) {
            const result = results[0];
            const pos = result.position;
            (self as unknown as Worker).postMessage({
                id: requestId,
                type: 'qrResult',
                data: result.text,
                cornerPoints: [
                    { x: pos.topLeft.x, y: pos.topLeft.y },
                    { x: pos.topRight.x, y: pos.topRight.y },
                    { x: pos.bottomRight.x, y: pos.bottomRight.y },
                    { x: pos.bottomLeft.x, y: pos.bottomLeft.y },
                ],
            });
            return;
        }
    } catch (e) {
        console.error('ZXing WASM error:', e);
    }

    (self as unknown as Worker).postMessage({
        id: requestId,
        type: 'qrResult',
        data: null,
    });
}

function setInversionMode(inversionMode: 'original' | 'invert' | 'both') {
    switch (inversionMode) {
        case 'original':
            tryInvert = false;
            break;
        case 'invert':
            tryInvert = true;
            break;
        case 'both':
            tryInvert = true;
            break;
        default:
            throw new Error('Invalid inversion mode');
    }
}

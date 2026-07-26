const { Jimp } = require('jimp');
const QrReader = require('qrcode-reader');

async function getQrValue(buf) {
  const image = await Jimp.read(buf);
  return new Promise((resolve, reject) => {
    const qr = new QrReader();
    qr.callback = (err, val) => {
      if (err) {
        return reject(err);
      }
      return resolve(val.result);
    };
    qr.decode(image.bitmap);
  });
}

module.exports = {
  getQrValue,
};

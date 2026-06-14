const { Communicate } = require('edge-tts-universal');
async function test() {
  try {
    const c = new Communicate(`1. The "Hidden Decimal" Trap (Most Likely)`, { voice: 'en-US-AriaNeural' });
    for await (const chunk of c.stream()) {
      console.log(chunk.type);
    }
  } catch(e) {
    console.error(e);
  }
}
test();

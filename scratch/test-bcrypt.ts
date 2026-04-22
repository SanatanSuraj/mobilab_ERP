import bcrypt from 'bcrypt';
async function test() {
  try {
    const hash = await bcrypt.hash('test', 10);
    console.log('Hash success:', hash);
    const ok = await bcrypt.compare('test', hash);
    console.log('Compare success:', ok);
  } catch (err) {
    console.error('Bcrypt error:', err);
  }
}
test();

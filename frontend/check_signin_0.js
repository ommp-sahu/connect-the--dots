
document.querySelectorAll('.toggle-pass').forEach(btn=>btn.addEventListener('click',()=>{const input=btn.parentElement.querySelector('input');input.type=input.type==='password'?'text':'password';btn.innerHTML=input.type==='password'?'<i class="fa-regular fa-eye"></i>':'<i class="fa-regular fa-eye-slash"></i>'}));
const notice=document.getElementById('notice');
document.getElementById('authForm').addEventListener('submit',e=>{e.preventDefault();const password=document.getElementById('password').value;notice.textContent="This is a frontend demo. Account creation and sign-in will work after we connect the backend and authentication provider.";notice.classList.add('show')});
document.getElementById('googleBtn').addEventListener('click',()=>{notice.textContent="Google sign-in is a visual placeholder for now. We'll connect Google OAuth during backend integration.";notice.classList.add('show')});
const forgot=document.getElementById('forgotLink');if(forgot)forgot.addEventListener('click',e=>{e.preventDefault();notice.textContent="Password reset will be available after authentication is connected.";notice.classList.add('show')});

import React from 'react';
import LoginForm from '../components/LoginForm.jsx';
import { Icons } from '../components/ui.jsx';

export default function MasterLogin() {
  return (
    <LoginForm
      expectedRole="master_admin"
      roleLabel="Master Login"
      subtitle="Full control over every building"
      icon={Icons.shield}
    />
  );
}

import React from 'react';
import LoginForm from '../components/LoginForm.jsx';
import { Icons } from '../components/ui.jsx';

export default function FlatLogin() {
  return (
    <LoginForm
      expectedRole="resident"
      roleLabel="Flat Login"
      subtitle="View your maintenance & payments"
      icon={Icons.home}
      usernameLabel="Username / Login ID"
    />
  );
}

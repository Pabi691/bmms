import React from 'react';
import LoginForm from '../components/LoginForm.jsx';
import { Icons } from '../components/ui.jsx';

export default function BuildingLogin() {
  return (
    <LoginForm
      expectedRole="building_admin"
      roleLabel="Building Login"
      subtitle="Manage your building's finances"
      icon={Icons.building}
    />
  );
}

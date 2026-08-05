// Meeting Center JavaScript Functions
let meetingFeatures = [];
let deletedMeetingFeatures = [];

function toggleMeetingDropdown(dropdownId) {
  const dropdown = document.getElementById(dropdownId);
  const allDropdowns = ['shareDropdown', 'menuDropdown', 'moreDropdown'];
  
  allDropdowns.forEach(d => {
    if (d !== dropdownId) {
      const el = document.getElementById(d);
      if (el) el.style.display = 'none';
    }
  });
  
  dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
}

document.getElementById('memberSelect').addEventListener('change', function() {
  const individualSection = document.getElementById('individualMemberSection');
  if (this.value === 'individual') {
    individualSection.style.display = 'block';
    loadApprovedMembersForShare();
  } else {
    individualSection.style.display = 'none';
  }
});

function loadApprovedMembersForShare() {
  const memberList = document.getElementById('shareMemberList');
  memberList.innerHTML = '';
  
  // Load approved members from your existing system
  fetch(API + '/members/approved', {
    headers: { 'Authorization': 'Bearer ' + (adminSession.token || '') }
  })
  .then(res => res.json())
  .then(data => {
    if (data.members && data.members.length > 0) {
      data.members.forEach(member => {
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; align-items: center; padding: 8px; border-bottom: 1px solid rgba(0,224,255,0.2); transition: background 0.2s;';
        item.innerHTML = '<input type="checkbox" class="member-checkbox" id="shareMember_' + member.id + '" style="margin-right: 10px;"><label for="shareMember_' + member.id + '" style="flex: 1; font-size: 14px; color: #fff;">' + member.first_name + ' ' + member.last_name + '</label><span style="font-size: 12px; padding: 4px 8px; border-radius: 12px; background: rgba(76,175,80,0.2); color: #4caf50;">Approved</span>';
        memberList.appendChild(item);
      });
    }
  })
  .catch(err => {
    console.error('Error loading approved members:', err);
  });
}

function submitMeetingLink() {
  const memberSelect = document.getElementById('memberSelect').value;
  const meetingLink = document.getElementById('meetingLink').value;
  
  if (!meetingLink) {
    alert('Please enter a meeting link');
    return;
  }

  let selectedMembers = [];
  if (memberSelect === 'all') {
    document.querySelectorAll('.member-checkbox').forEach(checkbox => {
      selectedMembers.push(checkbox.id.replace('shareMember_', ''));
    });
  } else {
    document.querySelectorAll('.member-checkbox:checked').forEach(checkbox => {
      selectedMembers.push(checkbox.id.replace('shareMember_', ''));
    });
  }

  if (selectedMembers.length === 0) {
    alert('Please select at least one member');
    return;
  }

  alert('Meeting link sent to ' + selectedMembers.length + ' members successfully!');
  toggleMeetingDropdown('shareDropdown');
}

function downloadMinute() {
  alert('Downloading minute as PDF...');
}

function viewInvitations() {
  alert('Opening invitation management...');
}

function showFeaturePopup() {
  alert('Opening feature management popup...');
  toggleMeetingDropdown('menuDropdown');
}

function showAllFeatures() {
  alert('Showing all features...');
  toggleMeetingDropdown('menuDropdown');
}

function showFeatureTable() {
  alert('Opening feature data table...');
  toggleMeetingDropdown('menuDropdown');
}

function manageStructure() {
  alert('Opening structure management...');
  toggleMeetingDropdown('moreDropdown');
}

function manageRecords() {
  alert('Opening records management...');
  toggleMeetingDropdown('moreDropdown');
}

function manageTemplates() {
  alert('Opening template management...');
  toggleMeetingDropdown('moreDropdown');
}

function manageSettings() {
  alert('Opening settings...');
  toggleMeetingDropdown('moreDropdown');
}

function exportData() {
  alert('Exporting data...');
  toggleMeetingDropdown('moreDropdown');
}

function addResource() {
  const resourceList = document.getElementById('resourceList');
  const newItem = document.createElement('div');
  newItem.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px; margin-bottom: 8px;';
  newItem.innerHTML = '<span style="font-size: 20px;">ðŸ“Ž</span><input type="text" placeholder="Add resource link or description" style="flex: 1; padding: 10px; border: 1px solid rgba(0,224,255,0.3); border-radius: 6px; font-size: 14px; background: rgba(0,0,0,0.3); color: #fff;">';
  resourceList.appendChild(newItem);
}

function addAgendaItem() {
  const agendaList = document.getElementById('agendaList');
  const newItem = document.createElement('div');
  newItem.style.cssText = 'background: rgba(0,0,0,0.2); border-radius: 8px; padding: 20px; margin-bottom: 15px; border-left: 4px solid #00e0ff;';
  newItem.innerHTML = '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;"><input type="text" value="New Topic (15 Mins)" style="border: none; background: transparent; padding: 0; font-weight: 600; color: #00e0ff; font-size: 16px;"><span style="font-size: 13px; color: #b0bec5; background: rgba(0,224,255,0.1); padding: 4px 8px; border-radius: 4px;">15 Mins</span></div><div style="margin-bottom: 15px;"><label style="font-size: 13px; font-weight: 500; color: #b0bec5; margin-bottom: 5px; display: block;">Goal</label><input type="text" placeholder="Enter goal" style="width: 100%; padding: 10px; border: 1px solid rgba(0,224,255,0.3); border-radius: 6px; font-size: 14px; background: rgba(0,0,0,0.3); color: #fff;"></div><div style="margin-bottom: 15px;"><label style="font-size: 13px; font-weight: 500; color: #b0bec5; margin-bottom: 5px; display: block;">Notes</label><textarea placeholder="Enter notes..." style="width: 100%; padding: 10px; border: 1px solid rgba(0,224,255,0.3); border-radius: 6px; font-size: 14px; min-height: 80px; resize: vertical; background: rgba(0,0,0,0.3); color: #fff;"></textarea></div>';
  agendaList.appendChild(newItem);
}

function addParkingLotItem() {
  const parkingLotList = document.getElementById('parkingLotList');
  const newItem = document.createElement('div');
  newItem.style.cssText = 'background: rgba(0,0,0,0.2); border-radius: 8px; padding: 20px; margin-bottom: 15px; border-left: 4px solid #ff9800;';
  newItem.innerHTML = '<div style="margin-bottom: 15px;"><input type="text" placeholder="New parking lot item âž” Action: [Name] to follow up" style="width: 100%; padding: 10px; border: 1px solid rgba(0,224,255,0.3); border-radius: 6px; font-size: 14px; background: rgba(0,0,0,0.3); color: #fff;"></div>';
  parkingLotList.appendChild(newItem);
}

function addDecision() {
  const decisionsList = document.getElementById('decisionsList');
  const newItem = document.createElement('div');
  newItem.style.cssText = 'margin-bottom: 15px;';
  newItem.innerHTML = '<input type="text" placeholder="Decision: [Enter decision]" style="width: 100%; padding: 10px; border: 1px solid rgba(0,224,255,0.3); border-radius: 6px; font-size: 14px; background: rgba(0,0,0,0.3); color: #fff;">';
  decisionsList.appendChild(newItem);
}

function addTask() {
  const taskTable = document.getElementById('taskTable').getElementsByTagName('tbody')[0];
  const newRow = taskTable.insertRow();
  newRow.innerHTML = '<td style="padding: 12px; border-bottom: 1px solid rgba(0,224,255,0.1);"><input type="text" placeholder="Task description" style="width: 100%; padding: 8px; border: 1px solid rgba(0,224,255,0.3); border-radius: 4px; font-size: 13px; background: rgba(0,0,0,0.3); color: #fff;"></td><td style="padding: 12px; border-bottom: 1px solid rgba(0,224,255,0.1);"><input type="text" placeholder="Owner" style="width: 100%; padding: 8px; border: 1px solid rgba(0,224,255,0.3); border-radius: 4px; font-size: 13px; background: rgba(0,0,0,0.3); color: #fff;"></td><td style="padding: 12px; border-bottom: 1px solid rgba(0,224,255,0.1);"><input type="date" style="width: 100%; padding: 8px; border: 1px solid rgba(0,224,255,0.3); border-radius: 4px; font-size: 13px; background: rgba(0,0,0,0.3); color: #fff;"></td><td style="padding: 12px; border-bottom: 1px solid rgba(0,224,255,0.1);"><select style="padding: 8px; border: 1px solid rgba(0,224,255,0.3); border-radius: 4px; font-size: 13px; background: rgba(0,0,0,0.3); color: #fff;"><option selected>Not Started</option><option>In Progress</option><option>Completed</option></select></td><td style="padding: 12px; border-bottom: 1px solid rgba(0,224,255,0.1);"><button class="action-btn" style="padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; margin-right: 5px; background: rgba(0,224,255,0.2); color: #00e0ff;">Edit</button><button class="action-btn" style="padding: 4px 8px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; background: rgba(244,67,54,0.2); color: #f44336;">Delete</button></td>';
}

// Close dropdowns when clicking outside
document.addEventListener('click', function(event) {
  if (!event.target.closest('.meeting-nav')) {
    ['shareDropdown', 'menuDropdown', 'moreDropdown'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }
});
